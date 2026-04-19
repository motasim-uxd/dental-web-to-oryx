import { z } from "zod";

export const RealmSchema = z.string().min(1);

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const PhoneSchema = z.string().min(7);

export const ProvidersQuerySchema = z.object({
  apptType: z.string().min(1).default("Cleaning"),
});

export const AvailabilityQuerySchema = z.object({
  date: IsoDateSchema,
  apptType: z.string().min(1).default("Cleaning"),
  firstAvail: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const BookSchema = z.object({
  apptType: z.string().min(1).default("Cleaning"),
  reason: z.string().min(1).default("Cleaning"),
  notes: z.string().optional(),
  insurance: z
    .enum(["Yes", "No"])
    .optional()
    .describe("Does your child have insurance?"),
  insuranceCompany: z.string().optional(),
  insuranceMemberId: z.string().optional(),
  specialHealthcareNeeds: z.enum(["Yes", "No"]).optional(),
  specialHealthcareNeedsDetails: z.string().optional(),

  // slot fields
  date: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }),
  start: z.object({
    hour: z.number().int(),
    minute: z.number().int(),
    second: z.number().int().default(0),
    millis: z.number().int().default(0),
  }),
  end: z.object({
    hour: z.number().int(),
    minute: z.number().int(),
    second: z.number().int().default(0),
    millis: z.number().int().default(0),
  }),
  dayOfWeek: z.number().int(),
  operatoryId: z.number().int(),
  oralId: z.number().int(),

  // patient fields
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  preferredName: z.string().optional(),
  dob: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }),
  email: z.string().email(),
  phoneNumber: PhoneSchema,
  newOrExisting: z.enum(["new", "existing"]).default("new"),
});

