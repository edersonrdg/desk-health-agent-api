import { z } from 'zod';

export const MESSAGES_UPSERT = 'messages.upsert';

/**
 * Subset of the Evolution API v2 `messages.upsert` event that the normalizer
 * reads. Unknown fields pass through; message variants the normalizer doesn't
 * know stay valid and become `unsupported`.
 */
const messageSchema = z.looseObject({
  conversation: z.string().optional(),
  extendedTextMessage: z
    .looseObject({ text: z.string().optional() })
    .optional(),
  buttonsResponseMessage: z
    .looseObject({
      selectedButtonId: z.string().optional(),
      selectedDisplayText: z.string().optional(),
    })
    .optional(),
  templateButtonReplyMessage: z
    .looseObject({
      selectedId: z.string().optional(),
      selectedDisplayText: z.string().optional(),
    })
    .optional(),
  listResponseMessage: z
    .looseObject({
      title: z.string().optional(),
      singleSelectReply: z
        .looseObject({ selectedRowId: z.string().optional() })
        .optional(),
    })
    .optional(),
});

export const messagesUpsertEventSchema = z.looseObject({
  event: z.literal(MESSAGES_UPSERT),
  instance: z.string().min(1),
  data: z.looseObject({
    key: z.looseObject({
      id: z.string().min(1),
      remoteJid: z.string().min(1),
      fromMe: z.boolean(),
    }),
    pushName: z.string().nullish(),
    messageType: z.string().optional(),
    // Seconds since the epoch; some versions send it as a string.
    messageTimestamp: z.coerce.number().int().positive(),
    message: messageSchema.nullish(),
  }),
});

/** Any other event: only enough to log it and drop it (D16). */
const otherEventSchema = z.looseObject({
  event: z.string().refine((event) => event !== MESSAGES_UPSERT),
  instance: z.string().min(1),
});

export const evolutionWebhookSchema = z.union([
  messagesUpsertEventSchema,
  otherEventSchema,
]);

export type MessagesUpsertEvent = z.infer<typeof messagesUpsertEventSchema>;
export type EvolutionWebhookEvent = z.infer<typeof evolutionWebhookSchema>;

export function isMessagesUpsert(
  event: EvolutionWebhookEvent,
): event is MessagesUpsertEvent {
  return event.event === MESSAGES_UPSERT;
}
