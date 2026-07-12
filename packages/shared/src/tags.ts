import { z } from "zod";

export const tagSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
  created_at: z.string().datetime(),
});

export const tagsFileSchema = z.object({
  tags: z.array(tagSchema).default([]),
});

export type Tag = z.infer<typeof tagSchema>;
export type TagsFile = z.infer<typeof tagsFileSchema>;
