import { z } from 'zod';

// Course numbers are user-facing identifiers, not UUIDs. Never expand or compact them.
export const courseIdSchema = z.string().trim().min(1).max(40).regex(/^[^\u0000-\u001f\u007f]+$/).refine(value => value !== "." && value !== "..", "课程号不能是路径保留名称");