# twikoo-import-tools-typecho
[Typecho] 到 [Twikoo] 迁移脚本

由 [@Android] 制作

## 准备
在使用前需要有可连接的相应数据库，存放 [Typecho] 的数据。

### 关于[MySQL]的建议
如果没有 [MySQL] 环境，可在本地使用 [XAMPP] 来快速搭建。

之后再使用附带的 [phpMyAdmin] 将 [Typecho] 的数据库备份导入。

## 使用
1. 安装 [Git] 与 [Node.js] 。

2. 找一个合适的目录。

   运行`git clone https://github.com/Android-KitKat/twikoo-import-tools-typecho.git`，克隆仓库到本地。

3. 运行`cd twikoo-import-tools-typecho`，进入目录。

4. 运行`npm install`，安装依赖。

5. 复制`config.example.yml`文件，命名为`config.yml`，并填入正确的配置。

6. 运行`npm run start`，脚本将会读取数据库并生成可导入 [Twikoo] 的数据文件。

   生成的文件名为`comment.json`。

7. 确认无误后，在腾讯云的 [云开发 数据库] 备份并导入评论数据到`comment`集合。

## 特别鸣谢
感谢 [@大大的小蜗牛] 提供大量的测试数据，让工具更加完善。

[@Android]: https://android99.me
[Typecho]: http://typecho.org
[Twikoo]: https://twikoo.js.org
[MySQL]: https://www.mysql.com/cn/
[XAMPP]: https://www.apachefriends.org/zh_cn/
[phpMyAdmin]: https://www.phpmyadmin.net
[Git]: https://git-scm.com
[Node.js]: https://nodejs.org
[云开发 数据库]: https://console.cloud.tencent.com/tcb/db/
[@大大的小蜗牛]: https://eallion.com
