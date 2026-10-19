import { glob } from 'astro/loaders';
import { defineCollection, z } from 'astro:content';

const blogSchema = z.object({
  title: z.string(),
  description: z.string(),
  publishedAt: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
});

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
  schema: blogSchema,
});

const blogEnglish = defineCollection({
  loader: glob({ base: './src/content/blog-en', pattern: '**/*.md' }),
  schema: blogSchema,
});

const unrealDocSchema = z.object({
  title: z.string(),
  description: z.string(),
  sourceTitle: z.string(),
  sourceUrl: z.string().url(),
  engineVersion: z.literal('5.8'),
  reviewedAt: z.coerce.date(),
  order: z.number(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
});

const unrealCpp = defineCollection({
  loader: glob({ base: './src/content/unreal-engine/5.8/programming-with-cplusplus', pattern: '**/*.md' }),
  schema: unrealDocSchema,
});

const gameplaySystems = defineCollection({
  loader: glob({ base: './src/content/unreal-engine/5.8/gameplay-systems', pattern: '**/*.md' }),
  schema: unrealDocSchema,
});

export const collections = { blog, blogEnglish, unrealCpp, gameplaySystems };
