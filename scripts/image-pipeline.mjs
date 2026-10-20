import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertImages } from './convert-images.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function imagePipeline() {
  return {
    name: 'automatic-webp-images',
    hooks: {
      'astro:config:setup': async () => {
        await convertImages();
      },
      'astro:server:setup': ({ server, logger }) => {
        let timer;

        let pending = Promise.resolve();

        function onFile(filename) {
          const relative = path.relative(root, filename).replaceAll('\\', '/');

          const image = /^(src\/assets|public)\/.*\.(png|jpe?g)$/i.test(relative);

          const reference = /^src\/.*\.(astro|ts|js|css|md|mdx|json)$/i.test(relative);

          if (!image && !reference) return;

          clearTimeout(timer);
          timer = setTimeout(() => {
            pending = pending.then(() => convertImages()).catch(error => logger.error(error.message));
          }, 200);
        }

        server.watcher.add([path.join(root, 'src/assets'), path.join(root, 'public')]);
        server.watcher.on('add', onFile);
        server.watcher.on('change', onFile);
        server.httpServer?.once('close', () => {
          clearTimeout(timer);
          server.watcher.off('add', onFile);
          server.watcher.off('change', onFile);
        });
      },
    },
  };
}
