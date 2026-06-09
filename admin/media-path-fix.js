(function () {
  const TARGET_COLLECTIONS = new Set(['quick_posts', 'posts']);
  const IMAGE_EXT_RE = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/i;
  const SKIP_PATH_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;
  const URL_LIKE_RE = /^(?:https?:|blob:|data:|\/\/)/i;
  const POSTS_COLLECTION_PATH_RE = /^\/collections\/posts(?:\/filter(?:\/.*)?)?\/?$/;
  const POSTS_NEW_PATH_RE = /^\/collections\/posts\/new\/?$/;
  const POSTS_FILTER_PREFIX = '/collections/posts/filter/';
  const POSTS_CREATE_BUTTON_ATTR = 'data-blog-cms-folder-create-button';
  const POSTS_CREATE_BUTTON_STYLE_ID = 'blog-cms-folder-create-button-style';
  const PREVIEW_STYLE_ID = 'blog-cms-preview-style';
  const SITE_URL = 'https://qieliqiean.github.io/blog';
  const SITE_URL_OBJECT = new URL(SITE_URL.endsWith('/') ? SITE_URL : `${SITE_URL}/`);
  const SITE_ORIGIN = SITE_URL_OBJECT.origin;
  const SITE_BASE_PATH = normalizePathPart(SITE_URL_OBJECT.pathname);
  const SITE_BASE_PREFIX = SITE_BASE_PATH ? `/${SITE_BASE_PATH}` : '';
  let previewTemplatesRegistered = false;

  function normalizeLabelText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getEntryValue(entry, key) {
    return entry && typeof entry.get === 'function' ? entry.get(key) : '';
  }

  function getEntryData(entry) {
    return getEntryValue(entry, 'data');
  }

  function getEntryDataValue(entry, key) {
    const data = getEntryData(entry);
    return data && typeof data.get === 'function' ? data.get(key) : '';
  }

  function normalizePathPart(value) {
    return String(value || '').replace(/^\/+|\/+$/g, '');
  }

  function isIndexEntryPath(entryPath) {
    return /(?:^|\/)index\.[^.]+$/i.test(entryPath);
  }

  function decodePathPart(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function decodeNestedPath(value) {
    return String(value || '')
      .split('/')
      .map(decodePathPart)
      .join('/');
  }

  function getCurrentRouteUrl() {
    const hash = String(window.location.hash || '');
    const route = hash.startsWith('#/') ? hash.slice(1) : `${window.location.pathname}${window.location.search}`;

    return new URL(route || '/', window.location.origin);
  }

  function getCurrentRoutePath() {
    return getCurrentRouteUrl().pathname;
  }

  function getCurrentRouteSearchParams() {
    return getCurrentRouteUrl().searchParams;
  }

  function postAssetFolderName(entry, collectionName) {
    const entryPath = String(getEntryValue(entry, 'path') || getEntryValue(entry, 'slug') || '');
    const parts = entryPath.split('/').filter(Boolean);
    const filename = parts.pop() || '';
    const name = filename.replace(/\.[^.]+$/, '');

    if (collectionName === 'posts' && isIndexEntryPath(entryPath)) {
      return 'index';
    }

    if (name && name !== 'index') return name;

    return parts.pop() || name;
  }

  function prefixBareImagePath(rawPath, folderName) {
    const leadingDotSlash = rawPath.startsWith('./');
    const path = leadingDotSlash ? rawPath.slice(2) : rawPath;

    if (!folderName || SKIP_PATH_RE.test(path) || path.includes('/') || path.includes('\\')) {
      return rawPath;
    }

    if (!IMAGE_EXT_RE.test(path)) return rawPath;

    return `${folderName}/${path}`;
  }

  function rewriteMarkdownImagePaths(markdown, folderName) {
    if (!markdown || !folderName) return markdown;

    let inFence = false;

    return String(markdown)
      .split('\n')
      .map(line => {
        if (/^\s*(```|~~~)/.test(line)) {
          inFence = !inFence;
          return line;
        }

        if (inFence) return line;

        return line.replace(/(!\[[^\]]*]\()([^)\s]+)([^)]*)(\))/g, (match, start, imagePath, suffix, end) => {
          return `${start}${prefixBareImagePath(imagePath, folderName)}${suffix}${end}`;
        });
      })
      .join('\n');
  }

  function isPostsCollectionPage() {
    return POSTS_COLLECTION_PATH_RE.test(getCurrentRoutePath());
  }

  function isPostsNewEntryPage() {
    return POSTS_NEW_PATH_RE.test(getCurrentRoutePath());
  }

  function getCurrentPostsFolderFromRoute() {
    const routePath = getCurrentRoutePath();
    if (!routePath.startsWith(POSTS_FILTER_PREFIX)) return '';

    return normalizePathPart(decodeNestedPath(routePath.slice(POSTS_FILTER_PREFIX.length)));
  }

  function getCurrentFolderFromSearch() {
    return normalizePathPart(getCurrentRouteSearchParams().get('path'));
  }

  function buildAdminHashUrl(pathname, params) {
    const search = new URLSearchParams();

    Object.entries(params || {}).forEach(([key, value]) => {
      const normalized = String(value || '').trim();
      if (normalized) {
        search.set(key, normalized);
      }
    });

    const query = search.toString();
    return `#${pathname}${query ? `?${query}` : ''}`;
  }

  function slugifyPathSegment(rawValue) {
    return String(rawValue || '')
      .trim()
      .toLocaleLowerCase()
      .replace(/[']/g, '')
      .replace(/[.]/g, '-')
      .replace(/[\\/:*?"<>|#[\]{}%&@+=`~]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function encodePathSegments(value) {
    return String(value || '')
      .split('/')
      .filter(Boolean)
      .map(segment => encodeURIComponent(segment))
      .join('/');
  }

  function absolutizeSitePath(rawPath) {
    const path = String(rawPath || '').trim();
    if (!path) return '';
    if (URL_LIKE_RE.test(path)) return path;

    if (SITE_BASE_PREFIX && (path === SITE_BASE_PREFIX || path.startsWith(`${SITE_BASE_PREFIX}/`))) {
      return `${SITE_ORIGIN}${path}`;
    }

    if (path.startsWith('/')) {
      return `${SITE_ORIGIN}${SITE_BASE_PREFIX}${path}`;
    }

    return `${SITE_ORIGIN}${SITE_BASE_PREFIX}/${path.replace(/^\/+/, '')}`;
  }

  function extractMarkdownImagePaths(markdown) {
    if (!markdown) return [];

    let inFence = false;
    const paths = [];

    String(markdown)
      .split('\n')
      .forEach(line => {
        if (/^\s*(```|~~~)/.test(line)) {
          inFence = !inFence;
          return;
        }

        if (inFence) return;

        line.replace(/!\[[^\]]*]\(([^)\s]+)(?:[^)]*)\)/g, (match, imagePath) => {
          paths.push(imagePath);
          return match;
        });
      });

    return paths;
  }

  function resolveAssetWithCms(rawPath, getAsset) {
    if (!rawPath || typeof getAsset !== 'function') return '';

    try {
      const asset = getAsset(rawPath);
      if (!asset) return '';
      if (typeof asset === 'string') return asset;

      const nextValue = String(typeof asset.toString === 'function' ? asset.toString() : asset);
      return nextValue && nextValue !== '[object Object]' ? nextValue : '';
    } catch (error) {
      return '';
    }
  }

  function getEntryDateParts(entry) {
    const rawValue = String(getEntryDataValue(entry, 'date') || '').trim();
    const match = rawValue.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return {
        year: match[1],
        month: match[2],
        day: match[3],
      };
    }

    if (!rawValue) return null;

    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) return null;

    return {
      year: String(parsed.getFullYear()),
      month: String(parsed.getMonth() + 1).padStart(2, '0'),
      day: String(parsed.getDate()).padStart(2, '0'),
    };
  }

  function getEntrySourcePath(entry) {
    const entryPath = String(getEntryValue(entry, 'path') || '').trim();
    if (entryPath) {
      return entryPath
        .replace(/^source\/_posts\//, '')
        .replace(/^_posts\//, '')
        .replace(/\\/g, '/')
        .replace(/\.md$/i, '');
    }

    const dataPath = String(getEntryDataValue(entry, 'path') || '').trim();
    if (dataPath) {
      return dataPath.replace(/\\/g, '/').replace(/\.md$/i, '');
    }

    const slug = String(getEntryValue(entry, 'slug') || '').trim();
    return slug ? slug.replace(/\\/g, '/').replace(/\.md$/i, '') : '';
  }

  function getEntryPermalinkBase(entry) {
    const customPermalink = normalizePathPart(getEntryDataValue(entry, 'permalink'));
    if (customPermalink) {
      return `${SITE_BASE_PREFIX}/${encodePathSegments(customPermalink)}`;
    }

    const dateParts = getEntryDateParts(entry);
    const sourcePath = normalizePathPart(getEntrySourcePath(entry));
    if (!dateParts || !sourcePath) return '';

    return `${SITE_BASE_PREFIX}/${dateParts.year}/${dateParts.month}/${dateParts.day}/${encodePathSegments(sourcePath)}`;
  }

  function getPublishedAssetUrl(rawPath, entry) {
    const normalized = String(rawPath || '').trim().replace(/^\.\//, '');
    if (!normalized || URL_LIKE_RE.test(normalized) || normalized.startsWith('/')) return '';

    const permalinkBase = getEntryPermalinkBase(entry);
    if (!permalinkBase) return '';

    const filename = normalized.split('/').filter(Boolean).pop();
    if (!filename) return '';

    return `${SITE_ORIGIN}${permalinkBase}/${encodePathSegments(filename)}`;
  }

  function resolveCmsImageUrl(rawPath, entry, getAsset) {
    const normalized = String(rawPath || '').trim();
    if (!normalized) return '';
    if (URL_LIKE_RE.test(normalized)) return normalized;

    const cmsAsset = resolveAssetWithCms(normalized, getAsset);
    if (cmsAsset) return cmsAsset;

    if (normalized.startsWith('/')) {
      return absolutizeSitePath(normalized);
    }

    const publishedAsset = getPublishedAssetUrl(normalized, entry);
    return publishedAsset || normalized;
  }

  function rewriteStyleUrls(styleValue, resolveUrl) {
    return String(styleValue || '').replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote, rawPath) => {
      const nextUrl = resolveUrl(rawPath);
      return nextUrl ? `url(${quote}${nextUrl}${quote})` : match;
    });
  }

  function patchImageElements(root, resolveUrl) {
    if (!root || typeof root.querySelectorAll !== 'function') return;

    root.querySelectorAll('img[src]').forEach(image => {
      const rawSrc = String(image.getAttribute('src') || '').trim();
      const nextSrc = resolveUrl(rawSrc);
      if (nextSrc && nextSrc !== rawSrc) {
        image.setAttribute('src', nextSrc);
      }
    });
  }

  function patchBackgroundImageElements(root, resolveUrl) {
    if (!root || typeof root.querySelectorAll !== 'function') return;

    root.querySelectorAll('[style*="background-image"]').forEach(element => {
      const rawStyle = element.getAttribute('style') || '';
      const nextStyle = rewriteStyleUrls(rawStyle, resolveUrl);
      if (nextStyle !== rawStyle) {
        element.setAttribute('style', nextStyle);
      }
    });
  }

  function patchAdminDocumentMedia() {
    patchImageElements(document, rawPath => {
      return String(rawPath || '').startsWith('/image/') ? absolutizeSitePath(rawPath) : '';
    });

    patchBackgroundImageElements(document, rawPath => {
      return String(rawPath || '').startsWith('/image/') ? absolutizeSitePath(rawPath) : '';
    });
  }

  function patchPreviewRoot(root, entry, getAsset) {
    if (!root) return;

    const resolveUrl = rawPath => resolveCmsImageUrl(rawPath, entry, getAsset);
    patchImageElements(root, resolveUrl);
    patchBackgroundImageElements(root, resolveUrl);
  }

  function createPostPreviewComponent() {
    return createClass({
      displayName: 'BlogCmsPostPreview',

      componentDidMount: function () {
        this.setupPreviewObserver();
        this.patchPreviewMedia();
      },

      componentDidUpdate: function () {
        this.patchPreviewMedia();
      },

      componentWillUnmount: function () {
        if (this.previewObserver) {
          this.previewObserver.disconnect();
          this.previewObserver = null;
        }
      },

      setRootRef: function (element) {
        this.previewRoot = element;
      },

      setupPreviewObserver: function () {
        if (this.previewObserver || !this.previewRoot) return;

        this.previewObserver = new MutationObserver(() => {
          this.patchPreviewMedia();
        });

        this.previewObserver.observe(this.previewRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['src', 'style'],
        });
      },

      patchPreviewMedia: function () {
        patchPreviewRoot(this.previewRoot, this.props.entry, this.props.getAsset);
      },

      render: function () {
        const title = String(getEntryDataValue(this.props.entry, 'title') || '未命名文章');
        const date = String(getEntryDataValue(this.props.entry, 'date') || '').trim();
        const cover = getEntryDataValue(this.props.entry, 'cover');
        const coverUrl = resolveCmsImageUrl(cover, this.props.entry, this.props.getAsset);

        return h(
          'article',
          {
            className: 'blog-cms-preview',
            ref: element => this.setRootRef(element),
          },
          coverUrl
            ? h(
              'figure',
              { className: 'blog-cms-preview__cover' },
              h('img', { src: coverUrl, alt: title })
            )
            : null,
          h(
            'header',
            { className: 'blog-cms-preview__header' },
            h('h1', { className: 'blog-cms-preview__title' }, title),
            date ? h('p', { className: 'blog-cms-preview__meta' }, date) : null
          ),
          h('section', { className: 'blog-cms-preview__content' }, this.props.widgetFor('body'))
        );
      },
    });
  }

  function ensurePreviewStyles(CMS) {
    if (document.getElementById(PREVIEW_STYLE_ID) || typeof CMS.registerPreviewStyle !== 'function') return;

    const previewCss = `
      .blog-cms-preview {
        max-width: 860px;
        margin: 0 auto;
        padding: 28px 24px 48px;
        color: #1f2937;
        font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
        line-height: 1.8;
      }

      .blog-cms-preview__cover {
        margin: 0 0 24px;
      }

      .blog-cms-preview__cover img {
        display: block;
        width: 100%;
        max-height: 320px;
        border-radius: 18px;
        object-fit: cover;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.14);
      }

      .blog-cms-preview__header {
        margin-bottom: 24px;
      }

      .blog-cms-preview__title {
        margin: 0;
        color: #111827;
        font-size: 2rem;
        line-height: 1.25;
      }

      .blog-cms-preview__meta {
        margin: 10px 0 0;
        color: #6b7280;
        font-size: 0.95rem;
      }

      .blog-cms-preview__content img {
        max-width: 100%;
        height: auto;
        border-radius: 12px;
      }
    `;

    CMS.registerPreviewStyle(previewCss, { raw: true });

    const marker = document.createElement('meta');
    marker.id = PREVIEW_STYLE_ID;
    document.head.appendChild(marker);
  }

  function registerPreviewTemplates(CMS) {
    if (previewTemplatesRegistered || typeof createClass !== 'function' || typeof h !== 'function') return;

    ensurePreviewStyles(CMS);

    const previewComponent = createPostPreviewComponent();
    CMS.registerPreviewTemplate('quick_posts', previewComponent);
    CMS.registerPreviewTemplate('posts', previewComponent);
    previewTemplatesRegistered = true;
  }

  function ensurePostsCreateButtonStyles() {
    if (document.getElementById(POSTS_CREATE_BUTTON_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = POSTS_CREATE_BUTTON_STYLE_ID;
    style.textContent = `
      a[${POSTS_CREATE_BUTTON_ATTR}] {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 40px;
        padding: 0 30px;
        border-radius: 999px;
        background: #f5f6f9;
        color: #1f2937;
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
      }

      a[${POSTS_CREATE_BUTTON_ATTR}]:hover {
        background: #eceff4;
      }
    `;

    document.head.appendChild(style);
  }

  function findPostsCollectionTopRow() {
    const main = document.querySelector('main');
    if (!main) return null;

    const heading = Array.from(main.querySelectorAll('h1')).find(element => {
      return normalizeLabelText(element.textContent) === '文章库';
    }) || main.querySelector('h1');

    if (!heading || !heading.parentElement) return null;

    return heading.parentElement;
  }

  function getExistingPostsCreateLink(container) {
    return Array.from(container.querySelectorAll('a')).find(link => {
      if (link.hasAttribute(POSTS_CREATE_BUTTON_ATTR)) return false;

      const href = String(link.getAttribute('href') || link.href || '');
      return href.includes('/collections/posts/new');
    }) || null;
  }

  function ensurePostsCollectionCreateButton() {
    const existingCustomButton = document.querySelector(`[${POSTS_CREATE_BUTTON_ATTR}]`);

    if (!isPostsCollectionPage()) {
      if (existingCustomButton) existingCustomButton.remove();
      return;
    }

    const topRow = findPostsCollectionTopRow();
    if (!topRow) return;

    const currentFolder = getCurrentPostsFolderFromRoute();
    const nextHref = buildAdminHashUrl('/collections/posts/new', {
      path: currentFolder,
    });
    const nextLabel = currentFolder ? '在当前文件夹新建文章' : '新建文章';
    const existingCreateLink = getExistingPostsCreateLink(topRow);

    if (existingCreateLink) {
      existingCreateLink.setAttribute('href', nextHref);
      if (currentFolder) {
        existingCreateLink.textContent = nextLabel;
      }
      if (existingCustomButton) existingCustomButton.remove();
      return;
    }

    ensurePostsCreateButtonStyles();

    const button = existingCustomButton instanceof HTMLAnchorElement
      ? existingCustomButton
      : document.createElement('a');

    button.setAttribute(POSTS_CREATE_BUTTON_ATTR, '1');
    button.setAttribute('href', nextHref);
    button.textContent = nextLabel;

    if (button.parentElement !== topRow) {
      topRow.appendChild(button);
    }
  }

  function findControlInput(labelText) {
    const labels = Array.from(document.querySelectorAll('label[for]'));

    for (const label of labels) {
      const text = normalizeLabelText(label.textContent);
      if (!text || (text !== labelText && !text.startsWith(labelText + ' '))) continue;

      const field = document.getElementById(label.htmlFor);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        return field;
      }
    }

    return null;
  }

  function setInputValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function syncPostsPathField() {
    if (!isPostsNewEntryPage()) return;

    const titleInput = findControlInput('标题');
    const pathInput = findControlInput('保存路径');
    if (!titleInput || !pathInput) return;

    const baseFolder = getCurrentFolderFromSearch();
    const slug = slugifyPathSegment(titleInput.value);
    const nextAutoPath = slug ? (baseFolder ? `${baseFolder}/${slug}` : slug) : baseFolder;
    const currentValue = String(pathInput.value || '').trim();
    const lastAutoPath = pathInput.dataset.cmsAutoPath || '';
    const canAutoUpdate =
      currentValue === '' || currentValue === baseFolder || currentValue === lastAutoPath;

    if (canAutoUpdate && currentValue !== nextAutoPath) {
      setInputValue(pathInput, nextAutoPath);
    }

    pathInput.dataset.cmsAutoPath = nextAutoPath;
  }

  function bindPostsPathSync() {
    if (!isPostsNewEntryPage()) return;

    const titleInput = findControlInput('标题');
    const pathInput = findControlInput('保存路径');
    if (!titleInput || !pathInput) return;

    if (!titleInput.dataset.cmsPathSyncBound) {
      titleInput.addEventListener('input', syncPostsPathField);
      titleInput.dataset.cmsPathSyncBound = '1';
    }

    if (!pathInput.dataset.cmsPathSyncBound) {
      pathInput.addEventListener('blur', syncPostsPathField);
      pathInput.dataset.cmsPathSyncBound = '1';
    }

    syncPostsPathField();
  }

  function runPostsEnhancements() {
    bindPostsPathSync();
    ensurePostsCollectionCreateButton();
    patchAdminDocumentMedia();
  }

  function schedulePostsEnhancements() {
    window.requestAnimationFrame(runPostsEnhancements);
  }

  function patchHistoryMethod(methodName) {
    const original = window.history[methodName];
    if (typeof original !== 'function') return;

    window.history[methodName] = function () {
      const result = original.apply(this, arguments);
      schedulePostsEnhancements();
      return result;
    };
  }

  function registerMediaPathFix(CMS) {
    registerPreviewTemplates(CMS);

    CMS.registerEventListener({
      name: 'preSave',
      handler: ({ entry, collection }) => {
        const collectionName = collection && typeof collection.get === 'function'
          ? collection.get('name')
          : getEntryValue(entry, 'collection');

        if (typeof collectionName === 'string' && collectionName && !TARGET_COLLECTIONS.has(collectionName)) {
          return getEntryValue(entry, 'data');
        }

        const data = getEntryValue(entry, 'data');
        if (!data || typeof data.get !== 'function' || typeof data.set !== 'function') return data;

        const body = data.get('body');
        if (typeof body !== 'string') return data;

        const folderName = postAssetFolderName(entry, collectionName);
        const nextBody = rewriteMarkdownImagePaths(body, folderName);

        return nextBody === body ? data : data.set('body', nextBody);
      },
    });
  }

  window.BlogCmsMediaPathFix = {
    extractMarkdownImagePaths,
    resolveCmsImageUrl,
    rewriteMarkdownImagePaths,
    postAssetFolderName,
  };

  if (window.CMS) {
    registerMediaPathFix(window.CMS);
  }

  patchHistoryMethod('pushState');
  patchHistoryMethod('replaceState');
  window.addEventListener('popstate', schedulePostsEnhancements);
  window.addEventListener('hashchange', schedulePostsEnhancements);
  window.addEventListener('load', schedulePostsEnhancements);

  const observer = new MutationObserver(schedulePostsEnhancements);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
