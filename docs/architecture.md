# Project Architecture

## Structure

- `src/pages`: Astro route entry points; the Lock Knock project page is nested under `project/` and builds to `/project/lockknock/`.
- `src/components`: reusable presentation components.
- `src/data`: portfolio content, blog placeholders, and asset references.
- `src/content/blog`: local Markdown blog sources and their publishing template.
- `src/styles`: global visual system and page-specific styles.
- `src/assets`: Astro-managed static images, grouped into `projects`, `icons`, and `profile`.
- `Docs/project-content.md`: source profile and project copy used to establish the portfolio content.

## Home Page Layout

`src/pages/index.astro` composes the hero, skills, projects, blog, profile, and contact sections. Desktop content rows use a fixed 215px section-title column followed by a flexible content grid. The title column has `min-width: 0` so long labels do not enlarge the column and shift later grids horizontally. At widths of 720px or less, rows stack vertically. The blog row uses a two-column card grid on desktop and an explicit one-column, four-card vertical grid on mobile; this override lives in `src/styles/portfolio.css`, which loads after the shared styles. Published blog cards and project cards that link to a dedicated page open in the current tab; project cards without a URL retain their in-page detail dialog.

## Blog Content

`src/content.config.ts` defines the `blog` content collection with Astro's file glob loader. Every Markdown file in `src/content/blog` supplies a title, description, publication date, tags, and optional `draft` flag through frontmatter. `src/pages/blog/[slug].astro` filters drafts, statically generates one route per published file, and renders the Markdown body. The homepage reads the same collection, showing up to four published articles; `src/data/blog.ts` provides placeholders for empty slots. The first published article, `seer-protocol-analysis.md`, is a security-conscious Flash client and TCP protocol reading note; it documents message framing and engineering lessons without publishing credential, key-derivation, injection, or game-manipulation instructions.

The blog detail template builds its table of contents from rendered `h2` through `h4` elements in the browser. Missing heading IDs are generated once on load, entries with children are initially collapsed, and an intersection observer highlights the current section then reveals its ancestor path. When the reader changes sections, only system-opened branches outside that path are collapsed; manually expanded branches remain open. A fixed bottom-right return-to-top button appears after the reader passes the first viewport and scrolls smoothly to the top; it uses instant scrolling when the user requests reduced motion. Branches animate their height, opacity, and position on expansion or collapse, while the shared reduced-motion rule disables that animation for users who request it. The 320px table of contents keeps full multi-line heading labels and generous vertical spacing, and is fixed only above `1500px` to preserve the reading width. `blog.css` also adds non-interactive, token-based game-editor decorations to either side of the article on wide screens; they use theme variables so both system color schemes remain consistent.

Create an article by copying `src/content/blog/TEMPLATE.md`, renaming it to an English hyphenated slug, filling out the frontmatter, then removing `draft: true`. This keeps unpublished templates out of both the homepage and generated routes.

## Article Diagrams

The shared `ArticleDetailLayout.astro` supports fenced `mermaid` blocks in both blog articles and official documentation pages. `astro.config.mjs` excludes these blocks from Shiki so their original text remains available to the browser. `src/scripts/article-mermaid.ts` dynamically imports Mermaid only on pages containing diagrams, renders each block independently, and redraws diagrams when the system color scheme changes. Invalid diagrams retain their source and show a syntax-error message; other diagrams continue rendering. Diagram styles live in `src/styles/article-detail.css` and keep overflow inside the diagram container. The blog publishing template includes a small flowchart example.

## Site Icon

`public/favicon.svg` supplies the shared site icon for the homepage, blog detail pages, and project pages. Each page references the same root-relative icon URL, keeping browser tabs visually consistent.

## Theme System

`src/styles/global.css` defines the shared surface, text, border, decoration, shadow, and code-surface tokens. The `prefers-color-scheme: dark` media query replaces those tokens with a low-luminance paper surface, high-contrast text, and translucent light dividers; page-specific styles consume the same tokens. `index.astro` provides matching light and dark browser theme-color metadata.

`astro.config.mjs` configures Shiki with GitHub light and dark themes, emitting CSS custom properties rather than fixed inline colors. It preloads common native, web, configuration, shell, and database grammars, and normalizes familiar fence aliases such as `c++`, `c#`, `sh`, and `yml`. `src/styles/blog.css` applies the corresponding code-surface tokens and a Console-style font stack (`Consolas`, `Cascadia Mono`, `Courier New`) to both inline and fenced code, switching Shiki token colors with the system theme. Token color rules select only Shiki's custom-property output; legacy single dark-theme output maps its GitHub token palette to contrasting light-theme equivalents only in light mode, retaining the original light tokens in dark mode. It also defines the Markdown reading surface: heading hierarchy, marked lists, highlighted links, callout blockquotes, accented rules, horizontally scrollable tables, and responsive images. These rules are scoped under `.article-body` so they do not affect the homepage.

## Image Delivery

The home hero uses the cropped `public/hero-art.webp`, preloaded from `index.astro` because it is an above-the-fold CSS background. Legacy project-art styles use individual cropped WebP files rather than the full reference composition. `public/reference.png` remains a design source and is not requested by the home page.

Images imported by page and data modules live in `src/assets`. Project assets use `src/assets/projects/<project-slug>/`; profile and skill images use `src/assets/profile/` and `src/assets/icons/`. Asset directories and filenames use lowercase kebab-case. Legacy images are imported with Vite's `?url` query so they are bundled without Astro image metadata processing; this is required because several sources lack decodable metadata. `projects/conan/` and `projects/seer-plan/` are retained as source material for future project pages and are not currently imported.

## Lock Knock Project Page

`src/pages/project/lockknock.astro` is the dedicated `/project/lockknock/` route and uses `src/styles/lockknock.css`. Its fixed header identifies the studio as `舞台装置 GrewGame` and keeps the section navigation available while reading. Game artwork is imported from `src/assets/projects/lock-knock/` with Vite URL imports.

The maze gallery contains five image-only slices in a horizontal, scroll-snapped track. Visible previous/next controls scroll the track by most of its current width; every image remains individually focusable and opens the native dialog-based lightbox. This avoids visual captions while preserving meaningful alternative text and accessible control labels. The continuation section has one external Bilibili promotional-video link, and the page footer matches the shared Astro construction and copyright notice.
