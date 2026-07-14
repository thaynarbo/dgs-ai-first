import { z } from 'zod';

export const FeedbackInputSchema = z.object({
	queryId: z.string().uuid('queryId must be a valid UUID'),
	rating: z
		.number({ required_error: 'rating is required', invalid_type_error: 'rating must be a number' })
		.int('rating must be an integer')
		.min(1, 'rating must be between 1 and 5')
		.max(5, 'rating must be between 1 and 5'),
	comment: z.string().max(1000, 'comment must be at most 1000 characters').optional(),
	attendantEmail: z.string().email('attendantEmail must be a valid email'),
});

export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;
