import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { buildUnrealDocsArticles } from '../../../data/unreal-docs';

export const GET: APIRoute = async () => {
  const [cppEntries, gameplayEntries] = await Promise.all([
    getCollection('unrealCpp'),
    getCollection('gameplaySystems'),
  ]);

  const index = Object.fromEntries(buildUnrealDocsArticles(cppEntries, gameplayEntries).map(({ href, data, body }) => [
    href, `${data.title} ${data.description} ${body ?? ''}`.toLowerCase(),
  ]));

  return Response.json(index);
};
