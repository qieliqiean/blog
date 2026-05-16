# 博客可视化后台实施计划

目标：让朋友只通过网页后台完成写文章、改文章、上传图片和提交内容；Hexo 构建、部署、Git 操作都放在后台自动完成。

## 总体方案

采用 Decap CMS 作为网页后台，继续保留 Hexo + Butterfly 作为博客生成系统。

朋友最终看到的流程：

1. 打开 `https://qieliqiean.github.io/blog/admin/`
2. 登录
3. 新建或编辑文章
4. 上传封面和正文图片
5. 点击保存或提交审核
6. GitHub Actions 自动构建并发布博客

## 阶段 1：本机离线测试

目的：先验证后台配置与当前 Hexo 仓库兼容，不影响线上博客。

已加入文件：

- `source/admin/index.html`：后台入口页面。
- `source/admin/config.yml`：后台字段和文章目录配置。

本机测试步骤：

1. 安装依赖：`npm install`
2. 启动 Decap 本地代理：`npx decap-server`
3. 另开一个终端启动 Hexo：`npm run server`
4. 打开 `http://localhost:4000/blog/admin/`
5. 检查是否能看到文章集合。
6. 新建一篇测试文章，填写标题、时间、标签、分类、正文。
7. 上传一张测试图片，确认图片落到 `source/image/uploads/`。
8. 保存后检查 `source/_posts/` 是否生成 Markdown。
9. 运行 `npm run build`，确认 Hexo 可以正常生成静态文件。
10. 删除测试文章和测试图片，保持仓库干净。

注意：本地代理不支持 Decap 的审核流，所以阶段 1 只验证“能编辑、能保存、能构建”。

## 阶段 2：线上后台登录

目的：让朋友无需安装 Hexo、Git、Node，也能通过网页后台提交内容。

当前采用推荐的审核发布模式：

- `publish_mode: editorial_workflow`：后台保存内容时走草稿/审核工作流。
- `backend.open_authoring: true`：朋友不需要主仓库写权限；她用 GitHub 登录后，Decap 会把修改放到她的 fork，并在准备审核时创建 Pull Request。
- `backend.squash_merges: true`：CMS 合并审核稿时尽量压成一个提交，历史更干净。

Decap CMS 的 GitHub 后端需要 OAuth 认证服务。GitHub Pages 只能托管静态文件，不能保管 GitHub OAuth App 的 Client Secret，所以需要额外部署一个很小的 OAuth 代理。

推荐做法：Cloudflare Worker OAuth 代理。

1. 打开 GitHub Developer Settings，创建 OAuth App。
2. Homepage URL 填 OAuth 代理 URL，例如 `https://decap-blog-oauth.<你的账号>.workers.dev`。
3. Authorization callback URL 填 OAuth 代理 URL 加 `/callback`，例如 `https://decap-blog-oauth.<你的账号>.workers.dev/callback`。
4. 保存 GitHub OAuth App 的 Client ID 和 Client Secret。
5. 部署 Decap OAuth Cloudflare Worker。
6. 把 Client ID 和 Client Secret 写入 Worker 的 Secret/环境变量，不要写进博客仓库。
7. 在 `source/admin/config.yml` 中取消注释并填写：

```yaml
backend:
  base_url: https://decap-blog-oauth.<你的账号>.workers.dev
  auth_endpoint: /auth
```

部署完成后，朋友访问 `https://qieliqiean.github.io/blog/admin/`，点 GitHub 登录，写完文章后移到 Ready to Review，即可生成 Pull Request。

## 阶段 3：自动部署

目的：任何文章改动合并到 `source` 后，GitHub 自动运行 Hexo 构建并发布。

已新增 `.github/workflows/pages.yml`：

1. checkout 仓库
2. setup Node.js
3. `npm ci`
4. `npm run build`
5. 上传 `public/`
6. 使用 GitHub Pages Actions 发布

同时在 GitHub 仓库设置：

1. Settings -> Pages
2. Source 改为 GitHub Actions

当前 GitHub 仓库的 `main` 分支是已经生成好的静态站点内容。为了不覆盖这个发布历史，Hexo 源码和后台配置放在 `source` 分支；之后每次 `source` 分支有新提交，GitHub Actions 会运行 `npm run build`，并把 `public/` 发布到 GitHub Pages。

## 阶段 4：朋友电脑验证

朋友电脑无需安装项目依赖。只需要：

1. 有浏览器
2. 能登录对应账号
3. 打开后台网址
4. 完成一篇测试文章提交

如果采用审核发布模式，她只负责点“提交审核”；你在 GitHub 网页上把 Pull Request 合并到 `source` 分支即可。

## 风险和保护措施

- 误删文章：当前后台配置已设置 `delete: false`，先不允许从后台删除文章。
- 图片路径混乱：后台统一把新图片放到 `source/image/uploads/`，正文引用路径为 `/image/uploads/...`。
- 文章分类太乱：先允许自由输入；后续可以改成下拉选项。
- 审核流本地不可测：本地只测编辑链路，审核流在线上测试。
- 线上登录需要 OAuth：这是上线阶段的关键点，需要单独配置。

## 官方参考

- Decap CMS 安装后台：<https://decapcms.org/docs/install-decap-cms/>
- Decap CMS 本地代理：<https://decapcms.org/docs/decap-proxy/>
- Decap CMS GitHub 后端：<https://decapcms.org/docs/github-backend/>
- Decap CMS Open Authoring：<https://decapcms.org/docs/open-authoring/>
- Decap CMS OAuth Proxy：<https://decapcms.org/docs/backends-overview/#using-github-with-an-oauth-proxy>
- Cloudflare Worker OAuth Proxy 示例：<https://github.com/sterlingwes/decap-proxy>
- Hexo GitHub Pages Actions：<https://hexo.io/docs/github-pages>
- GitHub Pages 自定义 Actions 工作流：<https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>
