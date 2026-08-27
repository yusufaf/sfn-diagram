import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'
import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'

export const collections = {
    docs: defineCollection({
        loader: docsLoader(),
        // `pageActions` is read by starlight-page-actions off the entry data, so
        // the schema has to declare it or Starlight strips it from frontmatter.
        schema: docsSchema({
            extend: z.object({
                pageActions: z.boolean().optional().default(true),
            }),
        }),
    }),
}
