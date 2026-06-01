import { z } from 'zod';

export const changeItemCategorySchema = z.object({
  // The category to assign to this NF line item. `null` clears the category
  // (e.g. the user rejecting a wrong auto-guess). When set, the item's
  // categorySource becomes MANUAL so the auto-classifier never overwrites it.
  categoryId: z.string().uuid().nullable(),
  // When true, records the line description → category mapping as a learning
  // signal so future imports auto-classify similar lines.
  saveAlias: z.boolean().optional().default(true),
});

export type ChangeItemCategoryDto = z.infer<typeof changeItemCategorySchema>;
