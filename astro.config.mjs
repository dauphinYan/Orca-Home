import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL ?? 'https://dolphindream.cn';

export default defineConfig({
  site,
  base: process.env.BASE_PATH ?? '/',
  markdown: {
    syntaxHighlight: {
      type: 'shiki',
      excludeLangs: ['mermaid', 'math'],
    },
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: false,
      langs: [
        'c', 'cpp', 'csharp', 'javascript', 'typescript', 'jsx', 'tsx',
        'html', 'css', 'json', 'yaml', 'toml', 'xml', 'markdown',
        'bash', 'powershell', 'python', 'java', 'go', 'rust', 'sql',
        'cmake', 'diff', 'dockerfile',
      ],
      langAlias: {
        'c++': 'cpp',
        'c#': 'csharp',
        cs: 'csharp',
        sh: 'bash',
        shell: 'bash',
        ps: 'powershell',
        pwsh: 'powershell',
        yml: 'yaml',
        md: 'markdown',
      },
    },
  },
});
