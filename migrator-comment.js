'use strict';
const fs = require('fs');
const yaml = require('js-yaml');
const md5 = require('blueimp-md5');
const mysql = require('mysql');
const marked = require('marked');

// 设置Markdown解析参数
marked.setOptions({
    renderer: new marked.Renderer(),
    gfm: true,
    tables: true,
    breaks: true,
    pedantic: false,
    sanitize: true,
    smartLists: true,
    smartypants: true,
    silent: true
});

// 获取配置
const config = yaml.safeLoad(fs.readFileSync(process.argv[2] ? process.argv[2] : 'config.yml'));
// 创建MySQL数据库连接
const connection = mysql.createConnection(config.mysql);

/**
 * 格式化文本
 * @param {object} args 关键字
 * @returns {string} 格式化结果
 */
String.prototype.format = function (args) {
    let result = this;
    for (let arg in args) {
        result = result.replace(new RegExp(`{${arg}}`, 'g'), args[arg]);
    }
    return result;
}

/**
 * 计算哈希值
 * @param {string} value 值
 * @returns {string} 哈希值
 */
function hash(value) {
    if (!value) return null;
    let prefix = config.salt ? `${config.salt}-` : '';
    return md5(`${prefix}${value}`);
}

/**
 * 为数字补零
 * @param {int} number 数字
 * @param {int} count 位数
 * @returns {string} 补零结果
 */
function fillZero (number, count) {
    return (Array(count).join(0) + number).slice(-count);
}

/**
 * 按配置文件替换缩略名
 * @param {string} slug 缩略名
 * @returns {string} 替换结果
 */
function slugReplace(slug) {
    if (config.slugReplace && config.slugReplace[slug]) {
        return config.slugReplace[slug];
    } else {
        return slug;
    }
}

/**
 * 在数据库执行SQL语句
 * @param {string} sql SQL语句
 * @returns {Promise<object>} 执行结果
 */
async function executeSQL(sql) {
    return new Promise(function (resolve, reject) {
        connection.query(sql, function (error, results, fields) {
            error ? reject(error) : resolve(results);
        });
    });
}

/**
 * 获取忽略列表以外的全部评论
 * @returns {Promise<object>} 评论
 */
async function getComments() {
    let where = config.ignoreCID && config.ignoreCID.length > 0 ? ` WHERE cid NOT IN(${config.ignoreCID.join(',')})` : '';
    let results = await executeSQL(`SELECT * FROM \`${config.prefix}comments\`${where}`);
    return results;
}

/**
 * 获取分类元数据
 * @param {int} mid 元数据ID
 * @returns {Promise<object>} 分类元数据
 */
async function getCategoryMeta(mid) {
    if (mid.length === 0) return [];
    return await executeSQL(`SELECT * FROM \`${config.prefix}metas\` WHERE \`mid\` IN(${mid}) AND \`type\`="category"`);
}

/**
 * 通过内容获取关联的分类元数据
 * @param {int} cid 内容ID
 * @returns {Promise<object>} 分类元数据
 */
async function getCategoryMetaFromCID(cid) {
    if (cid.length === 0) return [];
    let relationships = await executeSQL(`SELECT * FROM \`${config.prefix}relationships\` WHERE \`cid\` IN(${cid})`);
    let mids = [];
    for (let relationship of relationships) {
        mids.push(relationship.mid);
    }
    return await getCategoryMeta(mids.join(','));
}

/**
 * 通过内容获取关联的分类缩略名
 * @param {int} cid 内容ID
 * @returns {Promise<string>} 分类缩略名
 */
async function getCategory(cid) {
    let metas = await getCategoryMetaFromCID(cid);
    return metas[0] ? metas[0].slug : '';
}

/**
 * 通过内容获取关联的多级分类缩略名
 * @param {int} cid 内容ID
 * @returns {Promise<string>} 多级分类缩略名
 */
async function getDirectory(cid) {
    let metas = await getCategoryMetaFromCID(cid);
    while (metas[0] && metas[0].parent != 0) {
        let parent = await getCategoryMeta(metas[0].parent);
        if (parent[0]) {
            metas.unshift(parent[0]);
        } else {
            break;
        }
    }
    let result = [];
    for (let meta of metas) {
        result.push(slugReplace(meta.slug));
    }
    return result.join('/');
}

/**
 * 获取内容的相对链接
 * @param {int} cid 内容ID
 * @returns {Promise<string>} 相对链接
 */
async function getURL(cid) {
    let result = (await executeSQL(`SELECT * FROM \`${config.prefix}contents\` WHERE \`cid\` IN(${cid})`))[0];
    let permalink;
    switch (result.type) {
        case 'post':
            permalink = config.postPermalink;
            break;
        case 'page':
            permalink = config.pagePermalink;
            break;
        default:
            permalink = "/{cid}/";
    }
    let created = new Date(result.created * 1000);
    return permalink.format({
        cid: result.cid,
        slug: slugReplace(result.slug),
        category: await getCategory(result.cid),
        directory: await getDirectory(result.cid),
        year: created.getFullYear(),
        month: fillZero(created.getMonth() + 1, 2),
        day: fillZero(created.getDate(), 2)
    });
}

/**
 * 获取上层评论的ID
 * @param {Map} comments 评论集合
 * @param {int} coid 查询评论ID
 * @param {boolean} root 是否追溯到最顶层评论
 * @returns {int} 评论ID
 */
function getParentID(comments, coid, root) {
    if (coid === 0) return null;
    let comment = comments.get(coid);
    while (root && comment && comment.parent != 0) {
        comment = comments.get(comment.parent);
    }
    return comment.coid;
}

/**
 * 清理为空值的预设字段
 * @param {object} data 数据
 * @returns {object} 清理结果
 */
function clean(data) {
    let result = {... data};
    const target = ['pid', 'rid', 'isSpam'];
    const value = [null, undefined];
    for (let index of target) {
        if (value.includes(result[index])) delete result[index];
    }
    return result;
}

/**
 * 转换Typecho评论为Twikoo评论
 * @returns {Promise<string>} Twikoo评论数据
 */
async function convert() {
    let output = '';
    let data = await getComments();
    let comments = new Map();
    for (let row of data) {
        comments.set(row.coid, row);
    }
    for (let comment of comments.values()) {
        try {
            let url = await getURL(comment.cid);
            let created = new Date(comment.created * 1000).getTime();
            let twikoo = clean({
                /* 标识符 */
                _id: hash(comment.coid),

                /* 评论人数据 */
                nick: comment.author,
                mail: comment.mail ? comment.mail.toLowerCase() : null,
                mailMd5: comment.mail ? md5(comment.mail.toLowerCase()) : null,
                link: comment.url,

                /* 评论数据 */
                ua: comment.agent || '',
                ip: comment.ip,
                master: comment.mail && config.email ? comment.mail.toLowerCase() === config.email.toLowerCase() : false,
                url: url,
                href: config.site ? `${config.site}${url}` : null,
                comment: marked(comment.text),
                isSpam: comment.status === 'spam' || null,

                /* 回复数据 */
                pid: hash(getParentID(comments, comment.parent)),
                rid: hash(getParentID(comments, comment.parent, true)),

                /* 时间 */
                created: created,
                updated: created
            });
            output += `${JSON.stringify(twikoo)}\n`;
            console.info(`已处理评论ID为 ${comment.coid} 的评论。\n${comment.author}:\n${comment.text}\n`);
        } catch (error) {
            console.error(`在处理评论ID为 ${comment.coid} 的评论时发生错误。\n${JSON.stringify(comment)}\n`);
            throw error;
        }
    }
    console.info(`共处理 ${comments.size} 条数据。`);
    return output;
}

/**
 * 程序入口
 * @returns {Promise<void>}
 */
async function run() {
    connection.connect();
    try {
        fs.writeFileSync('comment.json', await convert());
    } finally {
        connection.end();
    }
}

run();
