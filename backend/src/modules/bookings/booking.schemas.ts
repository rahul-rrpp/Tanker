import { z } from 'zod';
import { fullNameSchema, phoneSchema } from '../../utils/validators';
import { BOOKING_TABS } from './booking.common';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const locationInputSchema = z.object({
  address: z.string().trim().min(5, 'Enter the full address').max(400),
  placeId: z.string().trim().max(300).optional(),
  latitude: z.number().min(6).max(38, 'Location must be in India'),
  longitude: z.number().min(68).max(98, 'Location must be in India'),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/).optional().or(z.literal('').transform(() => undefined)),
  savedLocationId: z.string().uuid().optional(),
});

export const CAPACITY_PRESETS = [10, 12, 16, 20, 24, 30] as const;

const bookingFields = {
  pickup: locationInputSchema,
  delivery: locationInputSchema,
  routeIndex: z.number().int().min(0).max(5).default(0),
  productId: z.string().uuid('Select the product'),
  tankerCapacityKl: z.number().positive().min(1).max(60, 'Capacity cannot exceed 60 KL'),
  quantityKl: z.number().positive('Enter the quantity').max(2000),
  numberOfTankers: z.number().int().min(1).max(100),
  tankerTypeId: z.string().uuid().optional(),
  compartmentRequirement: z.enum(['ANY', 'SINGLE', 'MULTI']).default('ANY'),
  productCompatibility: z.enum(['ANY_COMPATIBLE', 'DEDICATED', 'CLEANED_CERTIFIED']).default('ANY_COMPATIBLE'),
  specialRequirements: optionalText(1000),
  loadingDate: dateOnly,
  loadingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
  loadingContactName: fullNameSchema,
  loadingContactPhone: phoneSchema,
  loadingInstructions: optionalText(1000),
  expectedDeliveryDate: dateOnly,
  deliveryContactName: fullNameSchema,
  deliveryContactPhone: phoneSchema,
  deliveryInstructions: optionalText(1000),
  customerOffer: z.number().positive('Enter your freight offer').max(100_000_000),
};

export const createBookingSchema = z
  .object(bookingFields)
  .strict()
  .superRefine((v, ctx) => {
    if (v.expectedDeliveryDate < v.loadingDate) {
      ctx.addIssue({ code: 'custom', path: ['expectedDeliveryDate'], message: 'Delivery date cannot be before the loading date' });
    }
    if (v.quantityKl > v.tankerCapacityKl * v.numberOfTankers) {
      ctx.addIssue({ code: 'custom', path: ['quantityKl'], message: 'Quantity exceeds the total capacity of the selected tankers' });
    }
  });

/** Fields a company may change while a booking is still searching and has no offers. */
export const updateBookingSchema = z
  .object({
    version: z.number().int().min(0),
    loadingDate: dateOnly.optional(),
    loadingTime: bookingFields.loadingTime.optional(),
    loadingContactName: fullNameSchema.optional(),
    loadingContactPhone: phoneSchema.optional(),
    loadingInstructions: optionalText(1000),
    expectedDeliveryDate: dateOnly.optional(),
    deliveryContactName: fullNameSchema.optional(),
    deliveryContactPhone: phoneSchema.optional(),
    deliveryInstructions: optionalText(1000),
    specialRequirements: optionalText(1000),
    customerOffer: bookingFields.customerOffer.optional(),
  })
  .strict();

export const cancelBookingSchema = z.object({ reason: z.string().trim().min(5, 'Tell us why you are cancelling').max(500) }).strict();

export const listBookingsSchema = z.object({
  tab: z.enum(Object.keys(BOOKING_TABS) as [keyof typeof BOOKING_TABS, ...(keyof typeof BOOKING_TABS)[]]).default('all'),
  q: z.string().trim().max(80).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  productId: z.string().uuid().optional(),
  capacity: z.coerce.number().positive().optional(),
  pickupCity: z.string().trim().max(80).optional(),
  deliveryCity: z.string().trim().max(80).optional(),
  status: z.enum(['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION', 'CONFIRMED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export const estimateSchema = z
  .object({
    pickup: z.object({ latitude: z.number(), longitude: z.number(), state: z.string().max(80).optional() }),
    delivery: z.object({ latitude: z.number(), longitude: z.number(), state: z.string().max(80).optional() }),
    routeIndex: z.number().int().min(0).max(5).default(0),
    productId: z.string().uuid(),
    tankerCapacityKl: z.number().positive().max(60),
    numberOfTankers: z.number().int().min(1).max(100).default(1),
    tankerTypeId: z.string().uuid().optional(),
  })
  .strict();

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type ListBookingsInput = z.infer<typeof listBookingsSchema>;
