/**
 * Full-scale route generator — Scalable to thousands of routes.
 * Covers the full spectrum of real enterprise SaaS type complexity.
 *
 * Usage:
 * npx tsx scripts/generate-complex-routes.ts       (Generates 1x - 250 routes)
 * npx tsx scripts/generate-complex-routes.ts 10    (Generates 10x - 2,500 routes)
 */

import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const OUT_DIR = join(process.cwd(), "scripts/routes");
const MULTIPLIER = Math.max(1, parseInt(process.argv[2] || "1", 10));

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

type RouteKind = "query" | "mutate" | "stream";

type RouteDef = {
  name: string;
  kind: RouteKind;
  comment: string;
  schemaRef: string;
  returnExpr: string;
};

type DomainDef = {
  domain: string;
  extraImports: string[];
  topLevel: string[];
  routes: RouteDef[];
};

// ---------------------------------------------------------------------------
// 25 base domain definitions
// ---------------------------------------------------------------------------

const BASE_DOMAINS: DomainDef[] = [
  // ── 01 auth ───────────────────────────────────────────────────────────────
  {
    domain: "auth",
    extraImports: [],
    topLevel: [
      `type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId   = Brand<string, "UserId">;
type SessionId = Brand<string, "SessionId">;`,

      `const CredentialSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"),   email: z.email(), password: z.string().min(8).max(128), totpCode: z.string().length(6).optional() }),
  z.object({ method: z.literal("oauth"),      provider: z.enum(["google","github","microsoft","okta"]), code: z.string(), redirectUri: z.string().url(), state: z.string() }),
  z.object({ method: z.literal("saml"),       orgSlug: z.string().regex(/^[a-z0-9-]+$/), samlResponse: z.string(), relayState: z.string().optional() }),
  z.object({ method: z.literal("magic_link"),  token: z.string().min(32) }),
  z.object({ method: z.literal("passkey"),     credentialId: z.string(), response: z.object({ authenticatorData: z.string(), clientDataJSON: z.string(), signature: z.string() }) }),
]);`,

      `const DeviceSchema = z.object({
  userAgent: z.string().max(512),
  ip: z.ipv4(),
  fingerprint: z.string().optional(),
  platform: z.enum(["web","ios","android","desktop"]).optional(),
});`,

      `const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  tokenType: z.literal("Bearer"),
  scope: z.array(z.string()),
});
type TokenPair = z.infer<typeof TokenPairSchema>;`,

      `const LoginSchema = z.intersection(CredentialSchema, z.object({ device: DeviceSchema.optional() }));`,
    ],
    routes: [
      {
        name: "login",
        kind: "mutate",
        comment: "Multi-method login.",
        schemaRef: "LoginSchema",
        returnExpr: `{ tokens: { accessToken:"jwt.a", refreshToken:"jwt.r", expiresIn:3600, tokenType:"Bearer" as const, scope:["read"] }, user: { id:"usr_01" as UserId } }`,
      },
      {
        name: "refresh",
        kind: "mutate",
        comment: "Rotate tokens.",
        schemaRef: `z.object({ refreshToken: z.string(), sessionId: z.string().uuid() })`,
        returnExpr: `{ accessToken:"jwt.new", refreshToken:"jwt.r2", expiresIn:3600, tokenType:"Bearer" as const, scope:["read"] }`,
      },
      {
        name: "logout",
        kind: "mutate",
        comment: "Invalidate session.",
        schemaRef: `z.object({ sessionId: z.string().uuid() })`,
        returnExpr: `{ revoked: true, sessionId: data.sessionId as SessionId }`,
      },
      {
        name: "mfaChallenge",
        kind: "mutate",
        comment: "Validate MFA after credential.",
        schemaRef: `z.object({ challengeToken: z.string(), code: z.string().length(6), method: z.enum(["totp","sms","email","webauthn"]) })`,
        returnExpr: `{ verified: true }`,
      },
      {
        name: "forgotPassword",
        kind: "mutate",
        comment: "Send reset link.",
        schemaRef: `z.object({ email: z.email() })`,
        returnExpr: `{ sent: true }`,
      },
      {
        name: "resetPassword",
        kind: "mutate",
        comment: "Apply new password.",
        schemaRef: `z.object({ token: z.string(), newPassword: z.string().min(8) })`,
        returnExpr: `{ success: true }`,
      },
      {
        name: "sessions",
        kind: "query",
        comment: "List active sessions.",
        schemaRef: `z.object({ cursor: z.string().optional(), limit: z.number().int().max(50).default(20) })`,
        returnExpr: `{ sessions: [] as Array<{ id: SessionId; device: z.infer<typeof DeviceSchema>; createdAt: string; current: boolean }>, nextCursor: null as string | null }`,
      },
      {
        name: "me",
        kind: "query",
        comment: "Current user profile.",
        schemaRef: `z.object({})`,
        returnExpr: `{ id: "usr_01" as UserId, email: "a@b.com", role: "admin" as const }`,
      },
      {
        name: "verifyEmail",
        kind: "mutate",
        comment: "Confirm email via code.",
        schemaRef: `z.object({ code: z.string().length(6) })`,
        returnExpr: `{ verified: true }`,
      },
      {
        name: "oauthCallback",
        kind: "mutate",
        comment: "Handle OAuth code exchange.",
        schemaRef: `z.object({ code: z.string(), state: z.string(), provider: z.enum(["google","github","microsoft","okta"]) })`,
        returnExpr: `{ tokens: { accessToken:"jwt.oauth", refreshToken:"jwt.r", expiresIn:3600, tokenType:"Bearer" as const, scope:["read"] } }`,
      },
    ],
  },

  // ── 02 users ──────────────────────────────────────────────────────────────
  {
    domain: "users",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const RoleSchema = z.enum(["owner","admin","member","viewer","billing","developer","support"]);
type Role = z.infer<typeof RoleSchema>;`,

      `const AddressSchema = z.object({ line1: z.string().max(200), line2: z.string().max(200).optional(), city: z.string().max(100), state: z.string().max(100).optional(), postalCode: z.string().max(20), country: z.string().length(2) });`,

      `const UserProfileSchema = z.object({
  id: z.string().uuid(), email: z.email(), emailVerified: z.boolean(),
  name: z.string().min(1).max(120), displayName: z.string().max(60).optional(),
  avatarUrl: z.string().url().nullable(), bio: z.string().max(500).optional(),
  timezone: z.string().optional(), locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
  role: RoleSchema, permissions: z.array(z.string()),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  address: AddressSchema.optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
type UserProfile = z.infer<typeof UserProfileSchema>;`,

      `const UserUpdateSchema = UserProfileSchema
  .pick({ name:true, displayName:true, bio:true, timezone:true, locale:true, avatarUrl:true })
  .extend({ address: AddressSchema.optional() })
  .partial();`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "Paginated user list.",
        schemaRef: `z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().max(100).default(20), roles: z.array(RoleSchema).optional(), search: z.string().max(200).optional(), emailVerified: z.boolean().optional(), sortBy: z.enum(["name","email","createdAt","lastSeen"]).default("createdAt"), sortDir: z.enum(["asc","desc"]).default("desc") })`,
        returnExpr: `{ users: [] as UserProfile[], total: 0, page: data.page, pageCount: 0 }`,
      },
      {
        name: "get",
        kind: "query",
        comment: "Fetch single user.",
        schemaRef: `z.object({ id: z.string().uuid() })`,
        returnExpr: `{ id: data.id, email:"a@b.com", emailVerified:true, name:"Alice", displayName:undefined, avatarUrl:null, bio:undefined, timezone:"UTC", locale:"en-US", role:"member" as Role, permissions:[], metadata:{}, address:undefined, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }`,
      },
      {
        name: "create",
        kind: "mutate",
        comment: "Create user account.",
        schemaRef: `UserProfileSchema.omit({ id:true, createdAt:true, updatedAt:true, emailVerified:true, permissions:true }).extend({ password: z.string().min(8) })`,
        returnExpr: `{ id:"usr_new", email: data.email }`,
      },
      {
        name: "update",
        kind: "mutate",
        comment: "Partial profile update.",
        schemaRef: `UserUpdateSchema.extend({ id: z.string().uuid() })`,
        returnExpr: `{ id: data.id, updated: true }`,
      },
      {
        name: "deactivate",
        kind: "mutate",
        comment: "Soft-delete user.",
        schemaRef: `z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() })`,
        returnExpr: `{ deactivated: true }`,
      },
      {
        name: "bulkRoleChange",
        kind: "mutate",
        comment: "Change role for many users.",
        schemaRef: `z.object({ userIds: z.array(z.string().uuid()).min(1).max(500), role: RoleSchema, reason: z.string().max(500).optional() })`,
        returnExpr: `{ updated: data.userIds.length, role: data.role }`,
      },
      {
        name: "permissionMatrix",
        kind: "query",
        comment: "All permissions by resource.",
        schemaRef: `z.object({ userId: z.string().uuid() })`,
        returnExpr: `{ userId: data.userId, matrix: {} as Record<string, Record<string, boolean>> }`,
      },
      {
        name: "activityLog",
        kind: "query",
        comment: "Recent activity events.",
        schemaRef: `z.object({ userId: z.string().uuid(), limit: z.number().int().max(100).default(20) })`,
        returnExpr: `{ events: [] as Array<{ action: string; ts: string; meta: Record<string, unknown> }> }`,
      },
      {
        name: "impersonate",
        kind: "mutate",
        comment: "Admin impersonation token.",
        schemaRef: `z.object({ targetUserId: z.string().uuid(), reason: z.string().min(10) })`,
        returnExpr: `{ impersonationToken: "imp.jwt", expiresIn: 900 }`,
      },
      {
        name: "exportData",
        kind: "stream",
        comment: "GDPR data export stream.",
        schemaRef: `z.object({ userId: z.string().uuid() })`,
        returnExpr: `{ type:"chunk" as const, resource:"profile" as const, data: {} as Record<string, unknown> }`,
      },
    ],
  },

  // ── 03 organizations ──────────────────────────────────────────────────────
  {
    domain: "organizations",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const PlanTier = z.enum(["free","starter","pro","business","enterprise"]);
type PlanTier = z.infer<typeof PlanTier>;`,

      `const OrgSettingsSchema = z.object({
  allowedDomains: z.array(z.string()).max(20).default([]),
  ssoRequired: z.boolean().default(false),
  mfaRequired: z.boolean().default(false),
  ipAllowlist: z.array(z.ipv4()).max(100).default([]),
  defaultRole: z.enum(["member","viewer"]).default("member"),
  sessionTimeoutMinutes: z.number().int().min(15).max(10080).default(1440),
  dataRetentionDays: z.number().int().min(30).max(3650).nullable().default(null),
  features: z.record(z.string(), z.boolean()).default({}),
});
type OrgSettings = z.infer<typeof OrgSettingsSchema>;`,

      `const OrgSchema = z.object({
  id: z.string(), name: z.string().min(2).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  plan: PlanTier, memberCount: z.number().int().nonnegative(),
  logoUrl: z.string().url().nullable(),
  settings: OrgSettingsSchema,
  createdAt: z.string().datetime(),
});
type Org = z.infer<typeof OrgSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "Orgs accessible to caller.",
        schemaRef: `z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().max(50).default(10) })`,
        returnExpr: `{ orgs: [] as Org[], total: 0 }`,
      },
      {
        name: "get",
        kind: "query",
        comment: "Fetch org by ID.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ id: data.id, name:"Acme", slug:"acme", plan:"enterprise" as PlanTier, memberCount:42, logoUrl:null, settings: OrgSettingsSchema.parse({}), createdAt: new Date().toISOString() } as  Org`,
      },
      {
        name: "create",
        kind: "mutate",
        comment: "Create new org.",
        schemaRef: `OrgSchema.omit({ id:true, memberCount:true, createdAt:true }).extend({ ownerId: z.string().uuid() })`,
        returnExpr: `{ id:"org_new", slug: data.slug }`,
      },
      {
        name: "update",
        kind: "mutate",
        comment: "Update org metadata.",
        schemaRef: `z.object({ id: z.string(), name: z.string().min(2).max(100).optional(), logoUrl: z.string().url().nullable().optional(), settings: OrgSettingsSchema.partial().optional() })`,
        returnExpr: `{ id: data.id, updated: true }`,
      },
      {
        name: "delete",
        kind: "mutate",
        comment: "Permanently delete org.",
        schemaRef: `z.object({ id: z.string(), confirmSlug: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "members",
        kind: "query",
        comment: "List org members.",
        schemaRef: `z.object({ orgId: z.string(), page: z.number().int().min(1).default(1), limit: z.number().int().max(100).default(20) })`,
        returnExpr: `{ members: [] as Array<{ userId:string; role:string; joinedAt:string }>, total: 0 }`,
      },
      {
        name: "addMember",
        kind: "mutate",
        comment: "Add user to org.",
        schemaRef: `z.object({ orgId: z.string(), userId: z.string().uuid(), role: z.enum(["owner","admin","member"]) })`,
        returnExpr: `{ added: true }`,
      },
      {
        name: "removeMember",
        kind: "mutate",
        comment: "Remove user from org.",
        schemaRef: `z.object({ orgId: z.string(), userId: z.string().uuid() })`,
        returnExpr: `{ removed: true }`,
      },
      {
        name: "transferOwner",
        kind: "mutate",
        comment: "Transfer org ownership.",
        schemaRef: `z.object({ orgId: z.string(), newOwnerId: z.string().uuid(), reason: z.string().optional() })`,
        returnExpr: `{ transferred: true }`,
      },
      {
        name: "auditLog",
        kind: "query",
        comment: "Org-scoped audit log.",
        schemaRef: `z.object({ orgId: z.string(), limit: z.number().int().max(100).default(25), cursor: z.string().optional() })`,
        returnExpr: `{ entries: [] as Array<{ id:string; actor:string; action:string; ts:string }>, nextCursor: null as string | null }`,
      },
    ],
  },

  // ── 04 billing ────────────────────────────────────────────────────────────
  {
    domain: "billing",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const PricingModelSchema = z.discriminatedUnion("model", [
  z.object({ model: z.literal("flat"),     pricePerMonth: z.number().nonnegative(), pricePerYear: z.number().nonnegative() }),
  z.object({ model: z.literal("per_seat"), pricePerSeatMonth: z.number().nonnegative(), minSeats: z.number().int().min(1), maxSeats: z.number().int().nullable() }),
  z.object({ model: z.literal("usage"),    includedUnits: z.number().int().nonnegative(), pricePerOverageUnit: z.number().nonnegative(), unitLabel: z.string() }),
  z.object({ model: z.literal("hybrid"),   base: z.number().nonnegative(), perSeat: z.number().nonnegative(), includedSeats: z.number().int().nonnegative() }),
]);
type PricingModel = z.infer<typeof PricingModelSchema>;`,

      `const SubscriptionSchema = z.object({
  id: z.string(), orgId: z.string(),
  tier: z.enum(["free","starter","pro","business","enterprise"]),
  pricing: PricingModelSchema,
  status: z.enum(["active","trialing","past_due","cancelled","paused","incomplete"]),
  seats: z.number().int().min(1),
  currentPeriodStart: z.string().datetime(), currentPeriodEnd: z.string().datetime(),
  cancelAtPeriodEnd: z.boolean(),
  metadata: z.record(z.string(), z.string()),
  addons: z.array(z.object({ id:z.string(), name:z.string(), quantity:z.number().int().min(1), unitPrice:z.number().nonnegative() })).default([]),
});
type Subscription = z.infer<typeof SubscriptionSchema>;`,
    ],
    routes: [
      {
        name: "getSubscription",
        kind: "query",
        comment: "Full subscription with pricing.",
        schemaRef: `z.object({ orgId: z.string() })`,
        returnExpr: `{ id:"sub_01", orgId:data.orgId, tier:"pro" as const, pricing:{ model:"per_seat", pricePerSeatMonth:12, minSeats:1, maxSeats:null } as  PricingModel, status:"active" as const, seats:10, currentPeriodStart: new Date().toISOString(), currentPeriodEnd: new Date().toISOString(), cancelAtPeriodEnd:false, metadata:{}, addons:[] } as  Subscription`,
      },
      {
        name: "previewUpgrade",
        kind: "query",
        comment: "Proration preview.",
        schemaRef: `z.object({ orgId: z.string(), targetTier: z.enum(["starter","pro","business","enterprise"]), targetSeats: z.number().int().min(1), billingInterval: z.enum(["monthly","annual"]) })`,
        returnExpr: `{ currentAmount:12000, newAmount:24000, prorationAmount:6000, effectiveDate: new Date().toISOString(), lineItems: [] as Array<{ description:string; amount:number; currency:string }> }`,
      },
      {
        name: "createCheckout",
        kind: "mutate",
        comment: "Stripe checkout session.",
        schemaRef: `z.object({ orgId: z.string(), tier: z.enum(["starter","pro","business","enterprise"]), seats: z.number().int().min(1), billingInterval: z.enum(["monthly","annual"]), addons: z.array(z.object({ id:z.string(), quantity:z.number().int().min(1) })).default([]), successUrl: z.string().url(), cancelUrl: z.string().url(), couponCode: z.string().optional() })`,
        returnExpr: `{ checkoutUrl:"https://checkout.stripe.com/pay/cs_xxx", sessionId:"cs_xxx" }`,
      },
      {
        name: "cancelSubscription",
        kind: "mutate",
        comment: "Schedule cancellation.",
        schemaRef: `z.object({ orgId: z.string(), reason: z.string().max(500).optional() })`,
        returnExpr: `{ cancelAtPeriodEnd: true }`,
      },
      {
        name: "invoices",
        kind: "query",
        comment: "Paginated invoice list.",
        schemaRef: `z.object({ orgId: z.string(), limit: z.number().int().max(50).default(12), cursor: z.string().optional() })`,
        returnExpr: `{ invoices: [] as Array<{ id:string; amount:number; currency:string; status:string; date:string }>, nextCursor: null as string | null }`,
      },
      {
        name: "getInvoice",
        kind: "query",
        comment: "Invoice with line items.",
        schemaRef: `z.object({ invoiceId: z.string() })`,
        returnExpr: `{ id: data.invoiceId, lines: [] as Array<{ description:string; amount:number }>, total:0, currency:"usd" }`,
      },
      {
        name: "usageReport",
        kind: "query",
        comment: "Metered usage breakdown.",
        schemaRef: `z.object({ orgId: z.string(), breakdown: z.enum(["daily","weekly","monthly"]).default("daily") })`,
        returnExpr: `{ period:{ start: new Date().toISOString(), end: new Date().toISOString() }, included:10000, consumed:7430, overage:0, overageCost:0, series: [] as Array<{ date:string; units:number; cost:number }> }`,
      },
      {
        name: "applyPromoCode",
        kind: "mutate",
        comment: "Apply discount code.",
        schemaRef: `z.object({ orgId: z.string(), code: z.string().min(4).max(32) })`,
        returnExpr: `{ applied: true, discountPercent: 20 }`,
      },
      {
        name: "updatePaymentMethod",
        kind: "mutate",
        comment: "Attach new payment method.",
        schemaRef: `z.object({ orgId: z.string(), paymentMethodId: z.string() })`,
        returnExpr: `{ updated: true }`,
      },
      {
        name: "taxSettings",
        kind: "mutate",
        comment: "Update VAT/tax ID settings.",
        schemaRef: `z.object({ orgId: z.string(), taxId: z.string().optional(), taxIdType: z.enum(["eu_vat","us_ein","au_abn","gb_vat"]).optional(), address: z.object({ country: z.string().length(2), postalCode: z.string() }).optional() })`,
        returnExpr: `{ updated: true }`,
      },
    ],
  },

  // ── 05 projects ───────────────────────────────────────────────────────────
  {
    domain: "projects",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const ProjectStatus = z.enum(["planning","active","on_hold","completed","archived","cancelled"]);`,

      `const ProjectSchema = z.object({
  id: z.string(), orgId: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().max(5000).optional(),
  status: ProjectStatus,
  visibility: z.enum(["private","internal","public"]),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  ownerId: z.string().uuid(),
  tags: z.array(z.string().max(50)).max(20),
  customFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).refine(p => !p.startDate || !p.endDate || p.startDate <= p.endDate, { message: "startDate must be before endDate" });
type Project = z.infer<typeof ProjectSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "Paginated project list.",
        schemaRef: `z.object({ orgId: z.string(), status: z.array(ProjectStatus).optional(), search: z.string().optional(), page: z.number().int().min(1).default(1), limit: z.number().int().max(50).default(10) })`,
        returnExpr: `{ projects: [] as Project[], total:0 }`,
      },
      {
        name: "get",
        kind: "query",
        comment: "Project by ID.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ id:data.id, orgId:"org_01", name:"Alpha", status:"active" as const, visibility:"private" as const, startDate:null, endDate:null, ownerId:"usr_01", tags:[], customFields:{}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as  Project`,
      },
      {
        name: "create",
        kind: "mutate",
        comment: "Create project.",
        schemaRef: `ProjectSchema.omit({ id:true, createdAt:true, updatedAt:true })`,
        returnExpr: `{ id:"proj_new", name: data.name }`,
      },
      {
        name: "update",
        kind: "mutate",
        comment: "Update project.",
        schemaRef: `ProjectSchema.omit({ id:true, createdAt:true, updatedAt:true }).partial().extend({ id: z.string() })`,
        returnExpr: `{ id: data.id, updated:true }`,
      },
      {
        name: "archive",
        kind: "mutate",
        comment: "Archive project.",
        schemaRef: `z.object({ id: z.string(), reason: z.string().max(500).optional() })`,
        returnExpr: `{ archived: true }`,
      },
      {
        name: "members",
        kind: "query",
        comment: "Project members.",
        schemaRef: `z.object({ projectId: z.string() })`,
        returnExpr: `{ members: [] as Array<{ userId:string; role:z.infer<typeof z.enum(["lead","contributor","viewer"])>; joinedAt:string }> }`,
      },
      {
        name: "addMember",
        kind: "mutate",
        comment: "Add project member.",
        schemaRef: `z.object({ projectId: z.string(), userId: z.string().uuid(), role: z.enum(["lead","contributor","viewer"]) })`,
        returnExpr: `{ added: true }`,
      },
      {
        name: "stats",
        kind: "query",
        comment: "Project aggregate stats.",
        schemaRef: `z.object({ projectId: z.string(), period: z.enum(["7d","30d","90d"]).default("30d") })`,
        returnExpr: `{ tasks:42, completed:30, openIssues:5, velocity:8.2, burndownPoints: [] as Array<{ date:string; remaining:number }> }`,
      },
      {
        name: "duplicate",
        kind: "mutate",
        comment: "Clone project structure.",
        schemaRef: `z.object({ id: z.string(), newName: z.string().min(1).max(120), includeTasks: z.boolean().default(true), includeMembers: z.boolean().default(false) })`,
        returnExpr: `{ id:"proj_clone", name: data.newName }`,
      },
      {
        name: "export",
        kind: "stream",
        comment: "Stream full project export.",
        schemaRef: `z.object({ id: z.string(), format: z.enum(["json","csv"]) })`,
        returnExpr: `{ type:"row" as const, resource:"task" as const, data:{} as Record<string,unknown> }`,
      },
    ],
  },

  // ── 06 tasks ──────────────────────────────────────────────────────────────
  {
    domain: "tasks",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const TaskStatus = z.enum(["backlog","todo","in_progress","in_review","blocked","done","cancelled","wont_fix"]);
type TaskStatus = z.infer<typeof TaskStatus>;`,

      `const TaskPriority = z.enum(["critical","high","medium","low","none"]);`,

      `const CustomFieldValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"),    value: z.string().max(1000) }),
  z.object({ type: z.literal("number"),  value: z.number() }),
  z.object({ type: z.literal("date"),    value: z.string().datetime() }),
  z.object({ type: z.literal("boolean"), value: z.boolean() }),
  z.object({ type: z.literal("select"),  value: z.string(), optionId: z.string() }),
  z.object({ type: z.literal("multi"),   value: z.array(z.string()), optionIds: z.array(z.string()) }),
  z.object({ type: z.literal("user"),    value: z.string().uuid() }),
  z.object({ type: z.literal("url"),     value: z.string().url() }),
]);
type CustomFieldValue = z.infer<typeof CustomFieldValueSchema>;`,

      `type TaskNode = {
  id: string; title: string;
  status: TaskStatus; priority: z.infer<typeof TaskPriority>;
  subtasks?: {a: string}[];
  customFields: Record<string, CustomFieldValue>;
};`,

      `const TaskCreateSchema = z.object({
  projectId: z.string(), title: z.string().min(1).max(500),
  description: z.string().max(50000).optional(),
  status: TaskStatus.default("backlog"), priority: TaskPriority.default("medium"),
  assigneeIds: z.array(z.string().uuid()).max(10).default([]),
  parentId: z.string().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  labels: z.array(z.string().max(50)).max(20).default([]),
  estimateHours: z.number().nonnegative().max(10000).optional(),
  customFields: z.record(z.string(), CustomFieldValueSchema).default({}),
  dependencies: z.array(z.object({ taskId:z.string(), type:z.enum(["blocks","blocked_by","relates_to","duplicates"]) })).default([]),
}).refine(d => !d.startDate || !d.dueDate || d.startDate <= d.dueDate, { message:"startDate must be before dueDate", path:["startDate"] });`,
    ],
    routes: [
      {
        name: "create",
        kind: "mutate",
        comment: "Create task with full fields.",
        schemaRef: "TaskCreateSchema",
        returnExpr: `{ id:"task_new", title:data.title, status:data.status, priority:data.priority } as  Pick<TaskNode,"id"|"title"|"status"|"priority">`,
      },
      {
        name: "get",
        kind: "query",
        comment: "Task tree with subtasks.",
        schemaRef: `z.object({ id: z.string(), depth: z.number().int().min(0).max(5).default(1) })`,
        returnExpr: `{ id:data.id, title:"Fix login", status:"todo" as TaskStatus, priority:"high" as const, subtasks:[] as any[], customFields:{} as Record<string,CustomFieldValue> } as  TaskNode`,
      },
      {
        name: "update",
        kind: "mutate",
        comment: "Patch task fields.",
        schemaRef: `TaskCreateSchema.partial().extend({ id: z.string() })`,
        returnExpr: `{ id: data.id, updated: true }`,
      },
      {
        name: "delete",
        kind: "mutate",
        comment: "Delete task.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "bulkUpdate",
        kind: "mutate",
        comment: "Batch status/priority update.",
        schemaRef: `z.object({ ids: z.array(z.string()).min(1).max(500), patch: z.object({ status: TaskStatus.optional(), priority: TaskPriority.optional(), assigneeIds: z.array(z.string().uuid()).max(10).optional(), dueDate: z.string().datetime().nullable().optional() }).refine(o => Object.values(o).some(v => v !== undefined), { message:"At least one field required" }) })`,
        returnExpr: `{ updated: data.ids.length }`,
      },
      {
        name: "comments",
        kind: "query",
        comment: "Task comment thread.",
        schemaRef: `z.object({ taskId: z.string(), limit: z.number().int().max(100).default(50) })`,
        returnExpr: `{ comments: [] as Array<{ id:string; body:string; author:string; createdAt:string; reactions: Record<string,string[]> }> }`,
      },
      {
        name: "addComment",
        kind: "mutate",
        comment: "Post comment on task.",
        schemaRef: `z.object({ taskId: z.string(), body: z.string().min(1).max(5000), mentions: z.array(z.string().uuid()).default([]) })`,
        returnExpr: `{ id:"cmt_new", body: data.body }`,
      },
      {
        name: "timelineEvents",
        kind: "query",
        comment: "Typed audit trail.",
        schemaRef: `z.object({ taskId: z.string(), limit: z.number().int().max(100).default(50) })`,
        returnExpr: `{ events: [] as Array<{ type:"created"; actor:string; ts:string } | { type:"status_change"; actor:string; ts:string; from:TaskStatus; to:TaskStatus } | { type:"assigned"; actor:string; ts:string; userId:string }> }`,
      },
      {
        name: "activityStream",
        kind: "stream",
        comment: "Live project task updates.",
        schemaRef: `z.object({ projectId: z.string() })`,
        returnExpr: `{ type:"task_updated" as const, taskId:"task_01", field:"status", value:"done" }`,
      },
      {
        name: "myTasks",
        kind: "query",
        comment: "Tasks assigned to current user.",
        schemaRef: `z.object({ status: z.array(TaskStatus).optional(), projectId: z.string().optional(), limit: z.number().int().max(100).default(25) })`,
        returnExpr: `{ tasks: [] as any[], total: 0 }`,
      },
    ],
  },

  // ── 07 comments ───────────────────────────────────────────────────────────
  {
    domain: "comments",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const ResourceType = z.enum(["task","project","document","file","post"]);`,

      `const ReactionSchema = z.object({ emoji: z.string().max(8), users: z.array(z.string().uuid()) });`,

      `const CommentSchema = z.object({
  id: z.string(), resourceType: ResourceType, resourceId: z.string(),
  authorId: z.string().uuid(), body: z.string().min(1).max(50000),
  bodyHtml: z.string().optional(),
  mentions: z.array(z.string().uuid()),
  reactions: z.array(ReactionSchema),
  attachments: z.array(z.object({ id:z.string(), name:z.string(), url:z.string().url() })),
  parentId: z.string().nullable(),
  editedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
type Comment = z.infer<typeof CommentSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "Comments for a resource.",
        schemaRef: `z.object({ resourceType: ResourceType, resourceId: z.string(), cursor: z.string().optional(), limit: z.number().int().max(100).default(25) })`,
        returnExpr: `{ comments: [] as Comment[], nextCursor: null as string | null }`,
      },
      {
        name: "create",
        kind: "mutate",
        comment: "Post a comment.",
        schemaRef: `CommentSchema.omit({ id:true, bodyHtml:true, reactions:true, editedAt:true, createdAt:true })`,
        returnExpr: `{ id:"cmt_new" }`,
      },
      {
        name: "update",
        kind: "mutate",
        comment: "Edit comment body.",
        schemaRef: `z.object({ id: z.string(), body: z.string().min(1).max(50000) })`,
        returnExpr: `{ id: data.id, updated: true }`,
      },
      {
        name: "delete",
        kind: "mutate",
        comment: "Delete comment.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "react",
        kind: "mutate",
        comment: "Toggle emoji reaction.",
        schemaRef: `z.object({ commentId: z.string(), emoji: z.string().max(8) })`,
        returnExpr: `{ added: true, emoji: data.emoji }`,
      },
      {
        name: "thread",
        kind: "query",
        comment: "Threaded replies for comment.",
        schemaRef: `z.object({ parentId: z.string(), limit: z.number().int().max(50).default(20) })`,
        returnExpr: `{ replies: [] as Comment[], total: 0 }`,
      },
      {
        name: "resolve",
        kind: "mutate",
        comment: "Mark comment thread resolved.",
        schemaRef: `z.object({ commentId: z.string() })`,
        returnExpr: `{ resolved: true }`,
      },
      {
        name: "liveStream",
        kind: "stream",
        comment: "Stream new comments live.",
        schemaRef: `z.object({ resourceType: ResourceType, resourceId: z.string() })`,
        returnExpr: `{ type:"new_comment" as const, comment: {} as Comment }`,
      },
    ],
  },

  // ── 08 files ──────────────────────────────────────────────────────────────
  {
    domain: "files",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const FileStatus = z.enum(["pending","processing","ready","failed","deleted"]);`,

      `const FileMetaSchema = z.object({
  id: z.string(), name: z.string().min(1).max(255),
  mimeType: z.string(), sizeBytes: z.number().int().positive(),
  status: FileStatus, url: z.string().url().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  resourceType: z.enum(["project","task","comment","message","profile"]),
  resourceId: z.string(),
  uploadedBy: z.string().uuid(),
  metadata: z.record(z.string(), z.union([z.string(), z.number()])),
  createdAt: z.string().datetime(),
});
type FileMeta = z.infer<typeof FileMetaSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "Files for a resource.",
        schemaRef: `z.object({ resourceType: z.enum(["project","task","comment","message","profile"]), resourceId: z.string(), mimeTypes: z.array(z.string()).optional(), page: z.number().int().min(1).default(1) })`,
        returnExpr: `{ files: [] as FileMeta[], total: 0 }`,
      },
      {
        name: "get",
        kind: "query",
        comment: "File metadata by ID.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ id:data.id, name:"design.png", mimeType:"image/png", sizeBytes:204800, status:"ready" as const, url:"https://cdn.example.com/f", thumbnailUrl:null, resourceType:"task" as const, resourceId:"task_01", uploadedBy:"usr_01", metadata:{}, createdAt: new Date().toISOString() } as  FileMeta`,
      },
      {
        name: "requestUpload",
        kind: "mutate",
        comment: "Presigned S3 upload URL.",
        schemaRef: `z.object({ fileName: z.string().min(1).max(255), mimeType: z.string(), sizeBytes: z.number().int().max(100_000_000), resourceType: z.enum(["project","task","comment","message","profile"]), resourceId: z.string() })`,
        returnExpr: `{ uploadUrl:"https://s3.amazonaws.com/presigned", fileId:"file_pending", expiresIn:3600 }`,
      },
      {
        name: "confirmUpload",
        kind: "mutate",
        comment: "Mark upload complete.",
        schemaRef: `z.object({ fileId: z.string(), etag: z.string() })`,
        returnExpr: `{ id:data.fileId, confirmed:true, url:"https://cdn.example.com/"+data.fileId }`,
      },
      {
        name: "delete",
        kind: "mutate",
        comment: "Delete file and storage object.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "bulkDelete",
        kind: "mutate",
        comment: "Delete multiple files.",
        schemaRef: `z.object({ ids: z.array(z.string()).min(1).max(100) })`,
        returnExpr: `{ deleted: data.ids.length }`,
      },
      {
        name: "generateThumb",
        kind: "mutate",
        comment: "Trigger thumbnail generation.",
        schemaRef: `z.object({ fileId: z.string(), width: z.number().int().min(16).max(2048).default(256), height: z.number().int().min(16).max(2048).default(256), fit: z.enum(["cover","contain","fill"]).default("cover") })`,
        returnExpr: `{ jobId:"job_thumb", queued:true }`,
      },
      {
        name: "processStream",
        kind: "stream",
        comment: "Stream file processing events.",
        schemaRef: `z.object({ fileId: z.string() })`,
        returnExpr: `{ type:"progress" as const, fileId:data.fileId, percent:50, stage:"virus_scan" as const }`,
      },
    ],
  },

  // ── 09 notifications ──────────────────────────────────────────────────────
  {
    domain: "notifications",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const NotifType = z.enum(["mention","task_assigned","task_completed","comment","billing","security","system","workflow_run","integration_sync"]);`,

      `const NotifPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mention"),          commentId: z.string(), resourceType: z.string(), resourceId: z.string() }),
  z.object({ type: z.literal("task_assigned"),    taskId: z.string(), projectId: z.string() }),
  z.object({ type: z.literal("task_completed"),   taskId: z.string(), completedBy: z.string().uuid() }),
  z.object({ type: z.literal("comment"),          commentId: z.string(), taskId: z.string() }),
  z.object({ type: z.literal("billing"),          invoiceId: z.string(), amount: z.number(), currency: z.string() }),
  z.object({ type: z.literal("security"),         event: z.string(), ip: z.ipv4().optional() }),
  z.object({ type: z.literal("system"),           message: z.string() }),
  z.object({ type: z.literal("workflow_run"),     workflowId: z.string(), status: z.enum(["success","failed"]) }),
  z.object({ type: z.literal("integration_sync"), integrationId: z.string(), itemsSynced: z.number().int() }),
]);
type NotifPayload = z.infer<typeof NotifPayloadSchema>;`,

      `const NotifSchema = z.object({
  id: z.string(), type: NotifType, read: z.boolean(),
  payload: NotifPayloadSchema, createdAt: z.string().datetime(),
  actorId: z.string().uuid().nullable(),
});
type Notif = z.infer<typeof NotifSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "Paginated notification list.",
        schemaRef: `z.object({ unreadOnly: z.boolean().default(false), types: z.array(NotifType).optional(), limit: z.number().int().max(50).default(20), cursor: z.string().optional() })`,
        returnExpr: `{ notifications: [] as Notif[], unreadCount:3, nextCursor: null as string | null }`,
      },
      {
        name: "markRead",
        kind: "mutate",
        comment: "Mark notifications read.",
        schemaRef: `z.object({ ids: z.array(z.string()).min(1).max(100) })`,
        returnExpr: `{ marked: data.ids.length }`,
      },
      {
        name: "markAllRead",
        kind: "mutate",
        comment: "Mark all as read.",
        schemaRef: `z.object({})`,
        returnExpr: `{ marked: true }`,
      },
      {
        name: "preferences",
        kind: "query",
        comment: "Notification preferences.",
        schemaRef: `z.object({})`,
        returnExpr: `{ channels: { email:true, push:false, inApp:true } as Record<string,boolean>, types: {} as Partial<Record<z.infer<typeof NotifType>, boolean>> }`,
      },
      {
        name: "updatePreferences",
        kind: "mutate",
        comment: "Update preferences.",
        schemaRef: `z.object({ channels: z.record(z.string(), z.boolean()).optional(), types: z.record(z.string(), z.boolean()).optional() })`,
        returnExpr: `{ updated: true }`,
      },
      {
        name: "stream",
        kind: "stream",
        comment: "Real-time notification SSE.",
        schemaRef: `z.object({})`,
        returnExpr: `{ type:"notification" as const, notification: {} as Notif }`,
      },
      {
        name: "pushSubscribe",
        kind: "mutate",
        comment: "Register push subscription.",
        schemaRef: `z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) })`,
        returnExpr: `{ subscribed: true }`,
      },
    ],
  },

  // ── 10 search ─────────────────────────────────────────────────────────────
  {
    domain: "search",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const SearchableType = z.enum(["task","project","user","file","comment","workflow","document"]);`,

      `const SearchResultSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task"),     id:z.string(), title:z.string(), status:z.string(), projectId:z.string(), score:z.number() }),
  z.object({ type: z.literal("project"),  id:z.string(), name:z.string(), status:z.string(), score:z.number() }),
  z.object({ type: z.literal("user"),     id:z.string(), name:z.string(), email:z.string(), score:z.number() }),
  z.object({ type: z.literal("file"),     id:z.string(), name:z.string(), mimeType:z.string(), score:z.number() }),
  z.object({ type: z.literal("comment"),  id:z.string(), body:z.string(), resourceId:z.string(), score:z.number() }),
  z.object({ type: z.literal("workflow"), id:z.string(), name:z.string(), score:z.number() }),
  z.object({ type: z.literal("document"), id:z.string(), title:z.string(), score:z.number() }),
]);
type SearchResult = z.infer<typeof SearchResultSchema>;`,
    ],
    routes: [
      {
        name: "global",
        kind: "query",
        comment: "Full-text search across resources.",
        schemaRef: `z.object({ q: z.string().min(1).max(200), types: z.array(SearchableType).default(["task","project","user"]), orgId: z.string(), limit: z.number().int().max(50).default(10), highlight: z.boolean().default(true) })`,
        returnExpr: `{ results: [] as SearchResult[], total:0, took:42 }`,
      },
      {
        name: "suggestions",
        kind: "query",
        comment: "Autocomplete suggestions.",
        schemaRef: `z.object({ q: z.string().min(1).max(100), orgId: z.string(), types: z.array(SearchableType).optional() })`,
        returnExpr: `{ suggestions: [] as Array<{ label:string; type:z.infer<typeof SearchableType>; id:string }> }`,
      },
      {
        name: "filters",
        kind: "query",
        comment: "Faceted filter counts.",
        schemaRef: `z.object({ q: z.string().min(1), orgId: z.string(), types: z.array(SearchableType).optional() })`,
        returnExpr: `{ facets: {} as Record<z.infer<typeof SearchableType>, number> }`,
      },
      {
        name: "indexStatus",
        kind: "query",
        comment: "Search index health and stats.",
        schemaRef: `z.object({ orgId: z.string() })`,
        returnExpr: `{ indexed:10000, lag:0, lastUpdated: new Date().toISOString() }`,
      },
      {
        name: "stream",
        kind: "stream",
        comment: "Stream results for large corpora.",
        schemaRef: `z.object({ q: z.string().min(1), orgId: z.string(), types: z.array(SearchableType).optional() })`,
        returnExpr: `{ type:"result" as const, result: {} as SearchResult }`,
      },
      {
        name: "reindex",
        kind: "mutate",
        comment: "Trigger manual reindex.",
        schemaRef: `z.object({ orgId: z.string(), types: z.array(SearchableType).optional() })`,
        returnExpr: `{ jobId:"job_reindex", queued:true }`,
      },
    ],
  },

  // ── 11 analytics ──────────────────────────────────────────────────────────
  {
    domain: "analytics",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const Granularity = z.enum(["minute","hour","day","week","month"]);`,

      `const FilterOperatorSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("eq"),      value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ op: z.literal("neq"),     value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ op: z.literal("gt"),      value: z.number() }),
  z.object({ op: z.literal("gte"),     value: z.number() }),
  z.object({ op: z.literal("lt"),      value: z.number() }),
  z.object({ op: z.literal("lte"),     value: z.number() }),
  z.object({ op: z.literal("in"),      values: z.array(z.union([z.string(), z.number()])).min(1).max(100) }),
  z.object({ op: z.literal("between"), min: z.number(), max: z.number() }),
]);
type FilterOperator = z.infer<typeof FilterOperatorSchema>;`,

      `const QuerySchema = z.object({
  orgId: z.string(),
  metrics: z.array(z.string()).min(1).max(20),
  dimensions: z.array(z.string()).max(10).default([]),
  filters: z.array(z.object({ field:z.string(), operator:FilterOperatorSchema })).max(30).default([]),
  dateRange: z.object({ from:z.string().datetime(), to:z.string().datetime(), granularity:Granularity.default("day"), timezone:z.string().default("UTC") }),
  orderBy: z.array(z.object({ field:z.string(), direction:z.enum(["asc","desc"]) })).max(5).default([]),
  limit: z.number().int().max(10_000).default(1000),
  compareWith: z.object({ from:z.string().datetime(), to:z.string().datetime() }).optional(),
});
type AnalyticsQuery = z.infer<typeof QuerySchema>;`,

      `type QueryResult = {
  rows: Array<Record<string, string | number | boolean | null>>;
  totals: Record<string, number>;
  comparison?: Record<string, { current:number; previous:number; changePercent:number }>;
  meta: { executionMs:number; rowsScanned:number; cached:boolean; granularity:z.infer<typeof Granularity> };
};`,
    ],
    routes: [
      {
        name: "query",
        kind: "mutate",
        comment: "Arbitrary analytics query.",
        schemaRef: "QuerySchema",
        returnExpr: `{ rows:[], totals:{}, comparison:undefined, meta:{ executionMs:42, rowsScanned:10000, cached:false, granularity:data.dateRange.granularity } } as  QueryResult`,
      },
      {
        name: "funnel",
        kind: "mutate",
        comment: "Multi-step funnel conversion.",
        schemaRef: `z.object({ orgId:z.string(), steps:z.array(z.object({ name:z.string(), event:z.string(), filters:z.array(z.object({ field:z.string(), operator:FilterOperatorSchema })).default([]) })).min(2).max(10), dateRange:z.object({ from:z.string().datetime(), to:z.string().datetime() }) })`,
        returnExpr: `{ steps: [] as Array<{ name:string; count:number; conversionRate:number; avgTimeToNextStep:number|null }>, overallConversion:0 }`,
      },
      {
        name: "retention",
        kind: "mutate",
        comment: "Cohort retention analysis.",
        schemaRef: `z.object({ orgId:z.string(), cohortEvent:z.string(), returnEvent:z.string(), dateRange:z.object({ from:z.string().datetime(), to:z.string().datetime() }), granularity:Granularity.default("week") })`,
        returnExpr: `{ cohorts: [] as Array<{ date:string; size:number; retention:number[] }> }`,
      },
      {
        name: "savedReports",
        kind: "query",
        comment: "Saved report definitions.",
        schemaRef: `z.object({ orgId: z.string() })`,
        returnExpr: `{ reports: [] as Array<{ id:string; name:string; query:AnalyticsQuery; schedule:{ cron:string; recipients:string[] }|null; lastRunAt:string|null }> }`,
      },
      {
        name: "saveReport",
        kind: "mutate",
        comment: "Persist a report definition.",
        schemaRef: `z.object({ orgId:z.string(), name:z.string().min(1).max(200), query:QuerySchema, schedule:z.object({ cron:z.string(), recipients:z.array(z.email()).min(1) }).optional() })`,
        returnExpr: `{ id:"report_new", name: data.name }`,
      },
      {
        name: "exportStream",
        kind: "stream",
        comment: "Stream query results row by row.",
        schemaRef: `QuerySchema.extend({ format:z.enum(["json","csv","parquet"]).default("json") })`,
        returnExpr: `{ type:"row" as const, index:0, data:{} as Record<string, string|number|null> }`,
      },
    ],
  },

  // ── 12 webhooks ───────────────────────────────────────────────────────────
  {
    domain: "webhooks",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const WebhookEventType = z.enum([
  "task.created","task.updated","task.deleted","task.status_changed",
  "user.created","user.updated","user.deactivated",
  "project.created","project.archived",
  "billing.subscription_updated","billing.invoice_paid","billing.payment_failed",
  "file.uploaded","file.deleted",
  "workflow.run_completed","workflow.run_failed",
]);
type WebhookEventType = z.infer<typeof WebhookEventType>;`,

      `const WebhookSchema = z.object({
  id: z.string(), orgId: z.string(),
  url: z.string().url(), description: z.string().max(500).optional(),
  events: z.array(WebhookEventType).min(1),
  enabled: z.boolean(), secret: z.string().min(16),
  headers: z.record(z.string(), z.string()).default({}),
  retryPolicy: z.object({ maxAttempts:z.number().int().min(1).max(10), backoffMs:z.number().int().min(100) }).default({ maxAttempts:3, backoffMs:1000 }),
  createdAt: z.string().datetime(),
});
type Webhook = z.infer<typeof WebhookSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "Webhooks for an org.",
        schemaRef: `z.object({ orgId: z.string() })`,
        returnExpr: `{ webhooks: [] as Webhook[] }`,
      },
      {
        name: "get",
        kind: "query",
        comment: "Webhook by ID.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ id:data.id, orgId:"org_01", url:"https://example.com/hook", events:["task.created" as WebhookEventType], enabled:true, secret:"***", headers:{}, retryPolicy:{ maxAttempts:3, backoffMs:1000 }, createdAt: new Date().toISOString() } as  Omit<Webhook,"description">`,
      },
      {
        name: "create",
        kind: "mutate",
        comment: "Register webhook.",
        schemaRef: `WebhookSchema.omit({ id:true, createdAt:true })`,
        returnExpr: `{ id:"wh_new", url: data.url }`,
      },
      {
        name: "update",
        kind: "mutate",
        comment: "Update webhook.",
        schemaRef: `WebhookSchema.omit({ id:true, createdAt:true }).partial().extend({ id:z.string() })`,
        returnExpr: `{ id: data.id, updated: true }`,
      },
      {
        name: "delete",
        kind: "mutate",
        comment: "Remove webhook.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "deliveries",
        kind: "query",
        comment: "Recent delivery attempts.",
        schemaRef: `z.object({ webhookId: z.string(), status: z.enum(["success","failed","pending"]).optional(), limit: z.number().int().max(50).default(20) })`,
        returnExpr: `{ deliveries: [] as Array<{ id:string; status:number; attempt:number; ts:string; error:string|null }> }`,
      },
      {
        name: "redeliver",
        kind: "mutate",
        comment: "Retry failed delivery.",
        schemaRef: `z.object({ deliveryId: z.string() })`,
        returnExpr: `{ queued: true }`,
      },
      {
        name: "testPing",
        kind: "mutate",
        comment: "Send test event to webhook.",
        schemaRef: `z.object({ webhookId: z.string(), eventType: WebhookEventType })`,
        returnExpr: `{ sent: true, deliveryId:"del_test" }`,
      },
    ],
  },

  // ── 13 ai ─────────────────────────────────────────────────────────────────
  {
    domain: "ai",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const ContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"),        text: z.string() }),
  z.object({ type: z.literal("image_url"),   url: z.string().url(), detail: z.enum(["auto","low","high"]).default("auto") }),
  z.object({ type: z.literal("tool_use"),    toolCallId: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("tool_result"), toolCallId: z.string(), content: z.string(), isError: z.boolean().default(false) }),
]);
type ContentPart = z.infer<typeof ContentPartSchema>;`,

      `const MessageSchema = z.object({
  role: z.enum(["system","user","assistant","tool"]),
  content: z.union([z.string(), z.array(ContentPartSchema)]),
  name: z.string().optional(),
});
type Message = z.infer<typeof MessageSchema>;`,

      `const ToolSchema = z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), description: z.string().max(1024), parameters: z.record(z.string(), z.unknown()), strict: z.boolean().default(false) });`,

      `const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(200),
  model: z.enum(["gpt-4o","gpt-4o-mini","claude-sonnet-4-5","claude-haiku-4-5","gemini-1.5-pro"]),
  systemPrompt: z.string().max(8000).optional(),
  tools: z.array(ToolSchema).max(32).optional(),
  toolChoice: z.union([z.literal("auto"), z.literal("none"), z.literal("required"), z.object({ type: z.literal("function"), name: z.string() })]).default("auto"),
  temperature: z.number().min(0).max(2).default(1),
  maxTokens: z.number().int().min(1).max(128_000).optional(),
  responseFormat: z.discriminatedUnion("type", [
    z.object({ type: z.literal("text") }),
    z.object({ type: z.literal("json_object") }),
    z.object({ type: z.literal("json_schema"), schema: z.record(z.string(), z.unknown()), strict: z.boolean().default(true) }),
  ]).default({ type:"text" }),
  stop: z.array(z.string().max(20)).max(4).optional(),
});`,

      `type StreamEvent =
  | { type:"content_delta"; text:string }
  | { type:"tool_call"; toolCallId:string; name:string; argumentsDelta:string }
  | { type:"finish"; finishReason:"stop"|"tool_calls"|"length"|"content_filter"; usage:{ promptTokens:number; completionTokens:number } }
  | { type:"error"; code:string; message:string };`,
    ],
    routes: [
      {
        name: "chat",
        kind: "stream",
        comment: "Multi-model streaming chat.",
        schemaRef: "ChatRequestSchema",
        returnExpr: `{ type:"content_delta", text:"hello " } as  StreamEvent`,
      },
      {
        name: "complete",
        kind: "mutate",
        comment: "Non-streaming completion.",
        schemaRef: `ChatRequestSchema.extend({ stream: z.literal(false).default(false) })`,
        returnExpr: `{ id:"msg_01", role:"assistant" as const, content:"Hello!" as Message["content"], finishReason:"stop" as const, usage:{ promptTokens:100, completionTokens:50 } }`,
      },
      {
        name: "embed",
        kind: "mutate",
        comment: "Batch embedding generation.",
        schemaRef: `z.object({ inputs: z.array(z.union([z.string().min(1).max(8192), z.object({ text:z.string(), id:z.string() })])).min(1).max(100), model: z.enum(["text-embedding-3-small","text-embedding-3-large"]), dimensions: z.number().int().min(64).max(3072).optional(), outputFormat: z.enum(["float","base64","int8"]).default("float") })`,
        returnExpr: `{ embeddings: [] as Array<{ index:number; embedding:number[]; inputTokens:number }>, model:data.model, totalTokens:0 }`,
      },
      {
        name: "moderateContent",
        kind: "mutate",
        comment: "Content moderation.",
        schemaRef: `z.object({ inputs: z.array(z.object({ id:z.string(), text:z.string().max(10000) })).min(1).max(50), categories: z.array(z.enum(["hate","harassment","self_harm","sexual","violence","dangerous"])).optional() })`,
        returnExpr: `{ results: [] as Array<{ id:string; flagged:boolean; categories:Partial<Record<string,boolean>>; scores:Partial<Record<string,number>> }> }`,
      },
      {
        name: "summarize",
        kind: "mutate",
        comment: "Structured summarization.",
        schemaRef: `z.object({ text: z.string().min(50).max(50000), format: z.enum(["bullets","paragraph","tldr"]).default("paragraph"), maxLength: z.number().int().max(1000).default(200), language: z.string().optional() })`,
        returnExpr: `{ summary:"This document covers...", wordCount:42 }`,
      },
      {
        name: "usageStats",
        kind: "query",
        comment: "Token usage for billing period.",
        schemaRef: `z.object({ orgId: z.string(), period: z.enum(["current","30d","90d"]).default("current") })`,
        returnExpr: `{ promptTokens:500000, completionTokens:200000, totalCost:12.50, byModel:{} as Record<string,{ tokens:number; cost:number }> }`,
      },
    ],
  },

  // ── 14 audit ──────────────────────────────────────────────────────────────
  {
    domain: "audit",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const AuditAction = z.enum([
  "user.login","user.logout","user.created","user.updated","user.deactivated",
  "org.created","org.updated","org.deleted","org.member_added","org.member_removed",
  "task.created","task.updated","task.deleted","task.status_changed",
  "billing.plan_changed","billing.payment_failed",
  "file.uploaded","file.deleted",
  "webhook.created","webhook.deleted",
  "api_key.created","api_key.revoked",
  "settings.updated","sso.enabled","sso.disabled",
]);
type AuditAction = z.infer<typeof AuditAction>;`,

      `const AuditEntrySchema = z.object({
  id: z.string(), orgId: z.string(),
  actorId: z.string().uuid().nullable(), actorEmail: z.email().nullable(),
  action: AuditAction,
  resourceType: z.string().nullable(), resourceId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.ipv4().nullable(), userAgent: z.string().nullable(),
  ts: z.string().datetime(),
});
type AuditEntry = z.infer<typeof AuditEntrySchema>;`,
    ],
    routes: [
      {
        name: "log",
        kind: "query",
        comment: "Paginated audit log.",
        schemaRef: `z.object({ orgId:z.string(), actorId:z.string().uuid().optional(), actions:z.array(AuditAction).optional(), resourceType:z.string().optional(), resourceId:z.string().optional(), from:z.string().datetime().optional(), to:z.string().datetime().optional(), page:z.number().int().min(1).default(1), limit:z.number().int().max(100).default(25) })`,
        returnExpr: `{ entries: [] as AuditEntry[], total:0, page: data.page }`,
      },
      {
        name: "getEntry",
        kind: "query",
        comment: "Single audit entry.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ id:data.id, orgId:"org_01", actorId:"usr_01", actorEmail:"a@b.com", action:"user.login" as AuditAction, resourceType:null, resourceId:null, metadata:{}, ip:"1.2.3.4", userAgent:"Mozilla/5.0", ts: new Date().toISOString() } as  AuditEntry`,
      },
      {
        name: "export",
        kind: "stream",
        comment: "Stream audit log as NDJSON.",
        schemaRef: `z.object({ orgId:z.string(), from:z.string().datetime(), to:z.string().datetime(), actions:z.array(AuditAction).optional() })`,
        returnExpr: `{ type:"entry" as const, data:{} as AuditEntry }`,
      },
      {
        name: "retention",
        kind: "mutate",
        comment: "Update log retention policy.",
        schemaRef: `z.object({ orgId:z.string(), retentionDays:z.number().int().min(30).max(3650) })`,
        returnExpr: `{ updated:true, retentionDays: data.retentionDays }`,
      },
    ],
  },

  // ── 15 api-keys ───────────────────────────────────────────────────────────
  {
    domain: "api-keys",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const ApiKeyScope = z.enum([
  "read:all","write:all",
  "tasks:read","tasks:write",
  "users:read","users:write",
  "billing:read","analytics:read",
  "webhooks:manage","files:read","files:write",
]);
type ApiKeyScope = z.infer<typeof ApiKeyScope>;`,

      `const ApiKeySchema = z.object({
  id: z.string(), orgId: z.string(), name: z.string().min(1).max(100),
  prefix: z.string().length(8),
  scopes: z.array(ApiKeyScope).min(1),
  expiresAt: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  rateLimit: z.object({ requestsPerMinute: z.number().int().min(1).max(10000), requestsPerDay: z.number().int().min(1).max(1000000) }).nullable(),
});
type ApiKey = z.infer<typeof ApiKeySchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "List API keys for org.",
        schemaRef: `z.object({ orgId: z.string() })`,
        returnExpr: `{ keys: [] as ApiKey[] }`,
      },
      {
        name: "create",
        kind: "mutate",
        comment: "Create API key.",
        schemaRef: `ApiKeySchema.omit({ id:true, prefix:true, lastUsedAt:true, createdAt:true }).extend({ orgId:z.string() })`,
        returnExpr: `{ key:"sk_live_xxxxxxxx", id:"key_new", prefix:"sk_live_" }`,
      },
      {
        name: "revoke",
        kind: "mutate",
        comment: "Revoke an API key.",
        schemaRef: `z.object({ id: z.string(), reason: z.string().max(500).optional() })`,
        returnExpr: `{ revoked: true }`,
      },
      {
        name: "rotate",
        kind: "mutate",
        comment: "Rotate key secret.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ newKey:"sk_live_yyyyyyyy", id: data.id }`,
      },
      {
        name: "get",
        kind: "query",
        comment: "API key metadata.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ id:data.id, orgId:"org_01", name:"CI Key", prefix:"sk_live_", scopes:["read:all" as ApiKeyScope], expiresAt:null, lastUsedAt:null, createdBy:"usr_01", createdAt: new Date().toISOString(), rateLimit:null } as  ApiKey`,
      },
      {
        name: "usage",
        kind: "query",
        comment: "Key request usage stats.",
        schemaRef: `z.object({ id: z.string(), period: z.enum(["1h","24h","7d","30d"]).default("24h") })`,
        returnExpr: `{ requests:1234, errors:2, p50Ms:45, p99Ms:320, series: [] as Array<{ ts:string; count:number }> }`,
      },
    ],
  },

  // ── 16 integrations ───────────────────────────────────────────────────────
  {
    domain: "integrations",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const IntegrationId = z.enum(["slack","github","jira","linear","notion","figma","google_drive","dropbox","salesforce","hubspot","zendesk","pagerduty"]);
type IntegrationId = z.infer<typeof IntegrationId>;`,

      `const IntegrationStatusSchema = z.object({
  id: IntegrationId, name: z.string(),
  installed: z.boolean(), enabled: z.boolean(),
  status: z.enum(["active","error","disconnected","syncing"]),
  lastSyncAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
  config: z.record(z.string(), z.unknown()),
});
type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "All integrations with status.",
        schemaRef: `z.object({ orgId: z.string() })`,
        returnExpr: `{ integrations: [] as IntegrationStatus[] }`,
      },
      {
        name: "get",
        kind: "query",
        comment: "Single integration status.",
        schemaRef: `z.object({ orgId: z.string(), integrationId: IntegrationId })`,
        returnExpr: `{ id:data.integrationId, name:"Slack", installed:true, enabled:true, status:"active" as const, lastSyncAt: new Date().toISOString(), errorMessage:null, config:{} } as  IntegrationStatus`,
      },
      {
        name: "install",
        kind: "mutate",
        comment: "Start OAuth install flow.",
        schemaRef: `z.object({ orgId: z.string(), integrationId: IntegrationId, redirectUri: z.string().url(), scopes: z.array(z.string()).optional() })`,
        returnExpr: `{ authUrl:"https://slack.com/oauth/authorize?..." }`,
      },
      {
        name: "oauthCallback",
        kind: "mutate",
        comment: "Exchange OAuth code for tokens.",
        schemaRef: `z.object({ code: z.string(), state: z.string(), integrationId: IntegrationId })`,
        returnExpr: `{ installed:true, integrationId: data.integrationId }`,
      },
      {
        name: "uninstall",
        kind: "mutate",
        comment: "Remove integration and revoke.",
        schemaRef: `z.object({ orgId: z.string(), integrationId: IntegrationId })`,
        returnExpr: `{ uninstalled: true }`,
      },
      {
        name: "updateConfig",
        kind: "mutate",
        comment: "Update integration configuration.",
        schemaRef: `z.object({ orgId: z.string(), integrationId: IntegrationId, config: z.record(z.string(), z.unknown()) })`,
        returnExpr: `{ updated: true }`,
      },
      {
        name: "triggerSync",
        kind: "mutate",
        comment: "Manual sync trigger.",
        schemaRef: `z.object({ orgId: z.string(), integrationId: IntegrationId })`,
        returnExpr: `{ jobId:"job_sync_01", queued:true }`,
      },
      {
        name: "syncStream",
        kind: "stream",
        comment: "Stream sync progress events.",
        schemaRef: `z.object({ orgId: z.string(), integrationId: IntegrationId })`,
        returnExpr: `{ type:"progress" as const, integrationId:data.integrationId, itemsSynced:10, total:100 }`,
      },
    ],
  },

  // ── 17 workflows ──────────────────────────────────────────────────────────
  {
    domain: "workflows",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("send_email"),    to:z.array(z.email()), subject:z.string(), templateId:z.string() }),
  z.object({ type: z.literal("send_slack"),    channelId:z.string(), message:z.string().max(3000) }),
  z.object({ type: z.literal("webhook"),       url:z.string().url(), method:z.enum(["GET","POST","PUT","PATCH"]), headers:z.record(z.string(), z.string()).optional(), body:z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal("update_field"),  resourceType:z.string(), resourceId:z.string(), field:z.string(), value:z.unknown() }),
  z.object({ type: z.literal("create_task"),   projectId:z.string(), title:z.string(), assigneeId:z.string().uuid().optional() }),
  z.object({ type: z.literal("ai_summarize"),  inputField:z.string(), outputField:z.string(), model:z.string().optional() }),
]);
type WorkflowAction = z.infer<typeof ActionSchema>;`,

      `const ConditionSchema: z.ZodType<ConditionNode> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("leaf"),    field:z.string(), operator:z.enum(["eq","neq","gt","gte","lt","lte","contains","isNull"]), value:z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
  z.object({ kind: z.literal("and"),     conditions:z.array(z.lazy(() => ConditionSchema)).min(2) }),
  z.object({ kind: z.literal("or"),      conditions:z.array(z.lazy(() => ConditionSchema)).min(2) }),
  z.object({ kind: z.literal("not"),     condition:z.lazy(() => ConditionSchema) }),
]));
type ConditionNode = { kind:"leaf"; field:string; operator:string; value:unknown } | { kind:"and"; conditions:ConditionNode[] } | { kind:"or"; conditions:ConditionNode[] } | { kind:"not"; condition:ConditionNode };`,

      `const WorkflowDefSchema = z.object({
  name: z.string().min(1).max(200), description: z.string().max(1000).optional(),
  trigger: z.object({ event:z.string(), filters:ConditionSchema.optional(), debounceMs:z.number().int().nonnegative().optional() }),
  steps: z.array(z.object({ id:z.string(), name:z.string(), type:z.enum(["condition","action","delay","parallel"]), condition:ConditionSchema.optional(), action:ActionSchema.optional(), delayMs:z.number().int().nonnegative().optional(), nextStepIds:z.array(z.string()).default([]) })).min(1).max(50),
  enabled: z.boolean().default(true),
  retryPolicy: z.object({ maxAttempts:z.number().int().min(1).max(10), backoffMs:z.number().int().min(100), backoffMultiplier:z.number().min(1).max(10) }).optional(),
});`,
    ],
    routes: [
      {
        name: "create",
        kind: "mutate",
        comment: "Create workflow with recursive conditions.",
        schemaRef: `WorkflowDefSchema.extend({ orgId: z.string() })`,
        returnExpr: `{ id:"wf_new", name:data.name, enabled:data.enabled }`,
      },
      {
        name: "list",
        kind: "query",
        comment: "List workflows with run stats.",
        schemaRef: `z.object({ orgId:z.string(), enabled:z.boolean().optional() })`,
        returnExpr: `{ workflows: [] as Array<{ id:string; name:string; enabled:boolean; lastRunAt:string|null; runCount:number; failureRate:number }> }`,
      },
      {
        name: "get",
        kind: "query",
        comment: "Workflow detail with definition.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ id:data.id, name:"On task created", enabled:true, trigger:{ event:"task.created" }, steps:[], retryPolicy:undefined }`,
      },
      {
        name: "update",
        kind: "mutate",
        comment: "Update workflow definition.",
        schemaRef: `WorkflowDefSchema.partial().extend({ id: z.string() })`,
        returnExpr: `{ id: data.id, updated: true }`,
      },
      {
        name: "delete",
        kind: "mutate",
        comment: "Delete workflow.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "runHistory",
        kind: "query",
        comment: "Paginated run history.",
        schemaRef: `z.object({ workflowId:z.string(), status:z.enum(["running","success","failed","cancelled"]).optional(), limit:z.number().int().max(100).default(25), cursor:z.string().optional() })`,
        returnExpr: `{ runs: [] as Array<{ id:string; status:string; startedAt:string; finishedAt:string|null; steps:Array<{ stepId:string; status:string; durationMs:number; error?:string }> }>, nextCursor:null as string|null }`,
      },
      {
        name: "testRun",
        kind: "stream",
        comment: "Dry-run with streamed step outcomes.",
        schemaRef: `z.object({ workflowId:z.string(), samplePayload:z.record(z.string(), z.unknown()) })`,
        returnExpr: `{ type:"step_result" as const, stepId:"step_01", status:"success" as const, durationMs:12, output:{} as Record<string,unknown> }`,
      },
    ],
  },

  // ── 18 documents ──────────────────────────────────────────────────────────
  {
    domain: "documents",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const BlockType = z.enum(["paragraph","heading1","heading2","heading3","bullet_list","numbered_list","code","quote","divider","image","table","callout","toggle"]);`,

      `const InlineMarkSchema = z.object({ bold:z.boolean().optional(), italic:z.boolean().optional(), code:z.boolean().optional(), link:z.string().url().optional(), color:z.string().optional() });`,

      `const BlockSchema = z.object({
  id: z.string(), type: BlockType,
  content: z.array(z.object({ text:z.string(), marks:InlineMarkSchema.optional() })).optional(),
  children: z.array(z.string()).default([]),
  attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
type Block = z.infer<typeof BlockSchema>;`,

      `const DocumentSchema = z.object({
  id: z.string(), projectId: z.string(), title: z.string().min(1).max(500),
  blocks: z.array(BlockSchema),
  visibility: z.enum(["private","project","public"]),
  authorId: z.string().uuid(),
  collaborators: z.array(z.string().uuid()),
  version: z.number().int().nonnegative(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
type Document = z.infer<typeof DocumentSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "Documents in a project.",
        schemaRef: `z.object({ projectId:z.string(), page:z.number().int().min(1).default(1), limit:z.number().int().max(50).default(20), search:z.string().optional() })`,
        returnExpr: `{ documents: [] as Array<Pick<Document,"id"|"title"|"authorId"|"createdAt"|"updatedAt">>, total:0 }`,
      },
      {
        name: "get",
        kind: "query",
        comment: "Full document with blocks.",
        schemaRef: `z.object({ id:z.string(), version:z.number().int().optional() })`,
        returnExpr: `{ id:data.id, projectId:"proj_01", title:"Design doc", blocks:[] as Block[], visibility:"project" as const, authorId:"usr_01", collaborators:[], version:1, publishedAt:null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as  Document`,
      },
      {
        name: "create",
        kind: "mutate",
        comment: "Create document.",
        schemaRef: `DocumentSchema.omit({ id:true, version:true, createdAt:true, updatedAt:true, publishedAt:true })`,
        returnExpr: `{ id:"doc_new", title: data.title }`,
      },
      {
        name: "update",
        kind: "mutate",
        comment: "Update title/blocks/visibility.",
        schemaRef: `z.object({ id:z.string(), title:z.string().min(1).max(500).optional(), blocks:z.array(BlockSchema).optional(), visibility:z.enum(["private","project","public"]).optional() })`,
        returnExpr: `{ id:data.id, version:2 }`,
      },
      {
        name: "delete",
        kind: "mutate",
        comment: "Delete document.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "publish",
        kind: "mutate",
        comment: "Publish document publicly.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ publishedAt: new Date().toISOString(), url:"https://docs.example.com/doc_01" }`,
      },
      {
        name: "history",
        kind: "query",
        comment: "Document version history.",
        schemaRef: `z.object({ id:z.string(), limit:z.number().int().max(50).default(20) })`,
        returnExpr: `{ versions: [] as Array<{ version:number; editor:string; changedAt:string; summary:string }> }`,
      },
      {
        name: "editStream",
        kind: "stream",
        comment: "Collaborative edit event stream.",
        schemaRef: `z.object({ docId:z.string() })`,
        returnExpr: `{ type:"block_updated" as const, blockId:"blk_01", patch:{} as Record<string,unknown>, editorId:"usr_01" }`,
      },
    ],
  },

  // ── 19 teams ──────────────────────────────────────────────────────────────
  {
    domain: "teams",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const TeamSchema = z.object({
  id: z.string(), orgId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(4).optional(),
  visibility: z.enum(["public","private","secret"]),
  memberCount: z.number().int().nonnegative(),
  projectIds: z.array(z.string()),
  createdAt: z.string().datetime(),
});
type Team = z.infer<typeof TeamSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "Teams in an org.",
        schemaRef: `z.object({ orgId:z.string(), visibility:z.enum(["public","private","secret"]).optional() })`,
        returnExpr: `{ teams: [] as Team[] }`,
      },
      {
        name: "get",
        kind: "query",
        comment: "Team by ID.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ id:data.id, orgId:"org_01", name:"Engineering", description:undefined, color:"#3B82F6", icon:"⚙️", visibility:"public" as const, memberCount:12, projectIds:[], createdAt: new Date().toISOString() } as  Team`,
      },
      {
        name: "create",
        kind: "mutate",
        comment: "Create team.",
        schemaRef: `TeamSchema.omit({ id:true, memberCount:true, createdAt:true })`,
        returnExpr: `{ id:"team_new", name: data.name }`,
      },
      {
        name: "update",
        kind: "mutate",
        comment: "Update team metadata.",
        schemaRef: `TeamSchema.omit({ id:true, memberCount:true, createdAt:true }).partial().extend({ id:z.string() })`,
        returnExpr: `{ id: data.id, updated:true }`,
      },
      {
        name: "delete",
        kind: "mutate",
        comment: "Delete team.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "members",
        kind: "query",
        comment: "Team member list.",
        schemaRef: `z.object({ teamId:z.string(), page:z.number().int().min(1).default(1) })`,
        returnExpr: `{ members: [] as Array<{ userId:string; role:z.infer<typeof z.enum(["lead","member"])>; joinedAt:string }> }`,
      },
      {
        name: "addMember",
        kind: "mutate",
        comment: "Add user to team.",
        schemaRef: `z.object({ teamId:z.string(), userId:z.string().uuid(), role:z.enum(["lead","member"]) })`,
        returnExpr: `{ added: true }`,
      },
      {
        name: "removeMember",
        kind: "mutate",
        comment: "Remove user from team.",
        schemaRef: `z.object({ teamId:z.string(), userId:z.string().uuid() })`,
        returnExpr: `{ removed: true }`,
      },
    ],
  },

  // ── 20 invites ────────────────────────────────────────────────────────────
  {
    domain: "invites",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const InviteStatus = z.enum(["pending","accepted","declined","expired","revoked"]);`,

      `const InviteSchema = z.object({
  id: z.string(), orgId: z.string(),
  email: z.email(),
  role: z.enum(["owner","admin","member","viewer"]),
  status: InviteStatus,
  invitedBy: z.string().uuid(),
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  teams: z.array(z.string()).default([]),
  personalMessage: z.string().max(500).optional(),
  createdAt: z.string().datetime(),
});
type Invite = z.infer<typeof InviteSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "Pending invites for org.",
        schemaRef: `z.object({ orgId:z.string(), status:InviteStatus.optional() })`,
        returnExpr: `{ invites: [] as Invite[] }`,
      },
      {
        name: "create",
        kind: "mutate",
        comment: "Send invite.",
        schemaRef: `InviteSchema.omit({ id:true, status:true, invitedBy:true, expiresAt:true, acceptedAt:true, createdAt:true })`,
        returnExpr: `{ id:"inv_new", email:data.email }`,
      },
      {
        name: "bulkCreate",
        kind: "mutate",
        comment: "Bulk invite by email list.",
        schemaRef: `z.object({ orgId:z.string(), emails:z.array(z.email()).min(1).max(50), role:z.enum(["admin","member","viewer"]).default("member"), teams:z.array(z.string()).default([]) })`,
        returnExpr: `{ invited:data.emails.length, failed:[] as string[] }`,
      },
      {
        name: "accept",
        kind: "mutate",
        comment: "Accept an invite.",
        schemaRef: `z.object({ token:z.string() })`,
        returnExpr: `{ accepted:true, orgId:"org_01" }`,
      },
      {
        name: "decline",
        kind: "mutate",
        comment: "Decline an invite.",
        schemaRef: `z.object({ token:z.string() })`,
        returnExpr: `{ declined: true }`,
      },
      {
        name: "revoke",
        kind: "mutate",
        comment: "Revoke a pending invite.",
        schemaRef: `z.object({ id:z.string() })`,
        returnExpr: `{ revoked: true }`,
      },
      {
        name: "resend",
        kind: "mutate",
        comment: "Resend invite email.",
        schemaRef: `z.object({ id:z.string() })`,
        returnExpr: `{ sent: true }`,
      },
    ],
  },

  // ── 21 permissions ────────────────────────────────────────────────────────
  {
    domain: "permissions",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const Resource = z.enum(["task","project","document","file","comment","team","org","billing","webhook","api_key","integration","workflow","analytics"]);
type Resource = z.infer<typeof Resource>;`,

      `const Action = z.enum(["create","read","update","delete","manage","share","export","import","approve"]);
type Action = z.infer<typeof Action>;`,

      `const PolicyEffect = z.enum(["allow","deny"]);`,

      `const PolicyConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(["eq","neq","in","owned_by"]),
  value: z.union([z.string(), z.array(z.string()), z.literal("$userId"), z.literal("$orgId")]),
});`,

      `const PolicySchema = z.object({
  id: z.string(), orgId: z.string(), name: z.string().min(1).max(200),
  effect: PolicyEffect,
  resources: z.array(Resource).min(1),
  actions: z.array(Action).min(1),
  conditions: z.array(PolicyConditionSchema).default([]),
  subjects: z.array(z.object({ type:z.enum(["user","team","role"]), id:z.string() })).min(1),
  priority: z.number().int().min(0).max(1000).default(0),
  createdAt: z.string().datetime(),
});
type Policy = z.infer<typeof PolicySchema>;`,
    ],
    routes: [
      {
        name: "listPolicies",
        kind: "query",
        comment: "All policies for org.",
        schemaRef: `z.object({ orgId:z.string() })`,
        returnExpr: `{ policies: [] as Policy[] }`,
      },
      {
        name: "createPolicy",
        kind: "mutate",
        comment: "Create ABAC policy.",
        schemaRef: `PolicySchema.omit({ id:true, createdAt:true })`,
        returnExpr: `{ id:"pol_new", name: data.name }`,
      },
      {
        name: "updatePolicy",
        kind: "mutate",
        comment: "Update policy definition.",
        schemaRef: `PolicySchema.omit({ id:true, createdAt:true }).partial().extend({ id:z.string() })`,
        returnExpr: `{ id: data.id, updated:true }`,
      },
      {
        name: "deletePolicy",
        kind: "mutate",
        comment: "Delete policy.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "checkAccess",
        kind: "query",
        comment: "Evaluate access for subject.",
        schemaRef: `z.object({ orgId:z.string(), subjectId:z.string().uuid(), resource:Resource, action:Action, resourceId:z.string().optional() })`,
        returnExpr: `{ allowed:true, matchedPolicies: [] as string[] }`,
      },
      {
        name: "bulkCheck",
        kind: "mutate",
        comment: "Batch permission check.",
        schemaRef: `z.object({ orgId:z.string(), subjectId:z.string().uuid(), checks:z.array(z.object({ resource:Resource, action:Action, resourceId:z.string().optional() })).min(1).max(100) })`,
        returnExpr: `{ results: [] as Array<{ resource:Resource; action:Action; allowed:boolean }> }`,
      },
    ],
  },

  // ── 22 reports ────────────────────────────────────────────────────────────
  {
    domain: "reports",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const ReportType = z.enum(["task_summary","user_activity","project_velocity","billing_usage","audit_digest","custom"]);`,

      `const ScheduleSchema = z.object({
  cron: z.string(),
  timezone: z.string().default("UTC"),
  recipients: z.array(z.email()).min(1).max(50),
  format: z.enum(["pdf","csv","html"]).default("pdf"),
});`,

      `const ReportSchema = z.object({
  id: z.string(), orgId: z.string(),
  name: z.string().min(1).max(200), type: ReportType,
  config: z.record(z.string(), z.unknown()),
  schedule: ScheduleSchema.nullable(),
  lastRunAt: z.string().datetime().nullable(),
  lastRunStatus: z.enum(["success","failed","running"]).nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});
type Report = z.infer<typeof ReportSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "Saved reports for org.",
        schemaRef: `z.object({ orgId:z.string() })`,
        returnExpr: `{ reports: [] as Report[] }`,
      },
      {
        name: "create",
        kind: "mutate",
        comment: "Create report definition.",
        schemaRef: `ReportSchema.omit({ id:true, lastRunAt:true, lastRunStatus:true, createdAt:true })`,
        returnExpr: `{ id:"rep_new", name: data.name }`,
      },
      {
        name: "update",
        kind: "mutate",
        comment: "Update report.",
        schemaRef: `ReportSchema.omit({ id:true, lastRunAt:true, lastRunStatus:true, createdAt:true }).partial().extend({ id:z.string() })`,
        returnExpr: `{ id: data.id, updated:true }`,
      },
      {
        name: "delete",
        kind: "mutate",
        comment: "Delete report.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "run",
        kind: "mutate",
        comment: "Trigger report run.",
        schemaRef: `z.object({ id:z.string(), format:z.enum(["pdf","csv","html"]).optional() })`,
        returnExpr: `{ jobId:"job_rep_01", queued:true }`,
      },
      {
        name: "download",
        kind: "query",
        comment: "Get report download URL.",
        schemaRef: `z.object({ id:z.string(), runId:z.string() })`,
        returnExpr: `{ url:"https://cdn.example.com/reports/rep_01.pdf", expiresIn:3600 }`,
      },
      {
        name: "stream",
        kind: "stream",
        comment: "Stream report generation.",
        schemaRef: `z.object({ id:z.string() })`,
        returnExpr: `{ type:"progress" as const, percent:50, stage:"collecting_data" as const }`,
      },
    ],
  },

  // ── 23 tags ───────────────────────────────────────────────────────────────
  {
    domain: "tags",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const TagSchema = z.object({
  id: z.string(), orgId: z.string(),
  name: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().max(300).optional(),
  usageCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
type Tag = z.infer<typeof TagSchema>;`,
    ],
    routes: [
      {
        name: "list",
        kind: "query",
        comment: "All tags for org.",
        schemaRef: `z.object({ orgId:z.string(), search:z.string().optional(), sortBy:z.enum(["name","usageCount"]).default("usageCount") })`,
        returnExpr: `{ tags: [] as Tag[] }`,
      },
      {
        name: "create",
        kind: "mutate",
        comment: "Create tag.",
        schemaRef: `TagSchema.omit({ id:true, usageCount:true, createdAt:true })`,
        returnExpr: `{ id:"tag_new", name: data.name }`,
      },
      {
        name: "update",
        kind: "mutate",
        comment: "Update tag name/color.",
        schemaRef: `z.object({ id:z.string(), name:z.string().min(1).max(80).optional(), color:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), description:z.string().max(300).optional() })`,
        returnExpr: `{ id: data.id, updated:true }`,
      },
      {
        name: "delete",
        kind: "mutate",
        comment: "Delete tag.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "merge",
        kind: "mutate",
        comment: "Merge tags into one.",
        schemaRef: `z.object({ sourceIds:z.array(z.string()).min(2).max(20), targetId:z.string() })`,
        returnExpr: `{ merged: data.sourceIds.length, targetId: data.targetId }`,
      },
      {
        name: "attach",
        kind: "mutate",
        comment: "Attach tags to resources.",
        schemaRef: `z.object({ tagIds:z.array(z.string()).min(1).max(20), resourceType:z.enum(["task","project","document"]), resourceId:z.string() })`,
        returnExpr: `{ attached: data.tagIds.length }`,
      },
      {
        name: "detach",
        kind: "mutate",
        comment: "Detach tags from resource.",
        schemaRef: `z.object({ tagIds:z.array(z.string()).min(1), resourceType:z.enum(["task","project","document"]), resourceId:z.string() })`,
        returnExpr: `{ detached: data.tagIds.length }`,
      },
    ],
  },

  // ── 24 rate-limits ────────────────────────────────────────────────────────
  {
    domain: "rate-limits",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const RateLimitTarget = z.enum(["api_key","user","org","ip","endpoint"]);`,

      `const RateLimitRuleSchema = z.object({
  id: z.string(), orgId: z.string(),
  name: z.string().min(1).max(200),
  target: RateLimitTarget,
  targetId: z.string().nullable(),
  endpoint: z.string().nullable(),
  limits: z.array(z.object({
    window: z.enum(["second","minute","hour","day"]),
    max: z.number().int().min(1),
    burstAllowance: z.number().int().nonnegative().default(0),
  })).min(1).max(4),
  action: z.enum(["throttle","block","log"]).default("throttle"),
  enabled: z.boolean().default(true),
  createdAt: z.string().datetime(),
});
type RateLimitRule = z.infer<typeof RateLimitRuleSchema>;`,
    ],
    routes: [
      {
        name: "listRules",
        kind: "query",
        comment: "Rate limit rules for org.",
        schemaRef: `z.object({ orgId:z.string(), target:RateLimitTarget.optional() })`,
        returnExpr: `{ rules: [] as RateLimitRule[] }`,
      },
      {
        name: "createRule",
        kind: "mutate",
        comment: "Create rate limit rule.",
        schemaRef: `RateLimitRuleSchema.omit({ id:true, createdAt:true })`,
        returnExpr: `{ id:"rl_new", name: data.name }`,
      },
      {
        name: "updateRule",
        kind: "mutate",
        comment: "Update rule.",
        schemaRef: `RateLimitRuleSchema.omit({ id:true, createdAt:true }).partial().extend({ id:z.string() })`,
        returnExpr: `{ id: data.id, updated:true }`,
      },
      {
        name: "deleteRule",
        kind: "mutate",
        comment: "Delete rule.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ deleted: true }`,
      },
      {
        name: "currentStatus",
        kind: "query",
        comment: "Current usage against limits.",
        schemaRef: `z.object({ orgId:z.string(), target:RateLimitTarget.optional() })`,
        returnExpr: `{ statuses: [] as Array<{ ruleId:string; target:z.infer<typeof RateLimitTarget>; window:string; current:number; max:number; resetAt:string }> }`,
      },
      {
        name: "resetCounter",
        kind: "mutate",
        comment: "Manually reset a counter.",
        schemaRef: `z.object({ ruleId:z.string(), targetId:z.string() })`,
        returnExpr: `{ reset: true }`,
      },
    ],
  },

  // ── 25 exports ────────────────────────────────────────────────────────────
  {
    domain: "exports",
    extraImports: [`import { authMiddleware } from "../../../src/middleware";`],
    topLevel: [
      `const ExportFormat = z.enum(["json","csv","xlsx","pdf","ndjson","parquet"]);
type ExportFormat = z.infer<typeof ExportFormat>;`,

      `const ExportResourceSchema = z.discriminatedUnion("resource", [
  z.object({ resource:z.literal("tasks"),     projectId:z.string().optional(), filters:z.record(z.string(), z.unknown()).optional() }),
  z.object({ resource:z.literal("users"),     orgId:z.string() }),
  z.object({ resource:z.literal("analytics"), orgId:z.string(), metrics:z.array(z.string()).min(1), dateRange:z.object({ from:z.string().datetime(), to:z.string().datetime() }) }),
  z.object({ resource:z.literal("audit_log"), orgId:z.string(), from:z.string().datetime(), to:z.string().datetime() }),
  z.object({ resource:z.literal("billing"),   orgId:z.string(), year:z.number().int().min(2020).max(2099) }),
  z.object({ resource:z.literal("files"),     resourceType:z.string(), resourceId:z.string() }),
]);
type ExportResource = z.infer<typeof ExportResourceSchema>;`,

      `const ExportJobSchema = z.object({
  id: z.string(), orgId: z.string(),
  resource: ExportResourceSchema,
  format: ExportFormat,
  status: z.enum(["queued","running","done","failed"]),
  progress: z.number().min(0).max(100),
  rowCount: z.number().int().nonnegative().nullable(),
  downloadUrl: z.string().url().nullable(),
  expiresAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
type ExportJob = z.infer<typeof ExportJobSchema>;`,
    ],
    routes: [
      {
        name: "create",
        kind: "mutate",
        comment: "Queue an export job.",
        schemaRef: `z.object({ orgId:z.string(), resource:ExportResourceSchema, format:ExportFormat, notifyEmail:z.email().optional() })`,
        returnExpr: `{ id:"exp_new", status:"queued" as const }`,
      },
      {
        name: "list",
        kind: "query",
        comment: "Export job history.",
        schemaRef: `z.object({ orgId:z.string(), limit:z.number().int().max(50).default(20) })`,
        returnExpr: `{ jobs: [] as ExportJob[] }`,
      },
      {
        name: "get",
        kind: "query",
        comment: "Export job status.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ id:data.id, orgId:"org_01", resource:{ resource:"tasks" } as  ExportResource, format:"csv" as ExportFormat, status:"done" as const, progress:100, rowCount:500, downloadUrl:"https://cdn.example.com/exp.csv", expiresAt: new Date().toISOString(), error:null, createdAt: new Date().toISOString() } as  ExportJob`,
      },
      {
        name: "cancel",
        kind: "mutate",
        comment: "Cancel queued export.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ cancelled: true }`,
      },
      {
        name: "download",
        kind: "query",
        comment: "Fresh signed download URL.",
        schemaRef: `z.object({ id: z.string() })`,
        returnExpr: `{ url:"https://cdn.example.com/exp.csv", expiresIn:3600 }`,
      },
      {
        name: "progressStream",
        kind: "stream",
        comment: "Stream export progress.",
        schemaRef: `z.object({ jobId: z.string() })`,
        returnExpr: `{ type:"progress" as const, jobId:data.jobId, percent:50, rowsProcessed:250 }`,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Renderer & Helpers
// ---------------------------------------------------------------------------

function getExportName(domainName: string): string {
  // Convert "api-keys" to "apiKeys", and "api-keys_1" to "apiKeys1"
  return `${domainName.replace(/[-_]([a-z0-9])/gi, (_, c) =>
    c.toUpperCase()
  )}Routes`;
}

function renderRoute(r: RouteDef): string {
  if (r.kind === "stream") {
    return `
  /** ${r.comment} */
  ${r.name}(ctx) {
    return ctx.stream(${r.schemaRef}, async function* (data) {
      yield ${r.returnExpr};
      yield { type: "done" as const };
    });
  },`;
  }
  if (r.kind === "query") {
    return `
  /** ${r.comment} */
  ${r.name}(ctx) {
    return ctx.query(${r.schemaRef}, (data) => (${r.returnExpr}));
  },`;
  }
  return `
  /** ${r.comment} */
  ${r.name}(ctx) {
    return ctx.mutate(${r.schemaRef}, (data) => (${r.returnExpr}));
  },`;
}

function renderDomainFile(
  domainName: string,
  d: DomainDef,
  exportName: string
): string {
  const hasAuth = d.extraImports.some((i) => i.includes("authMiddleware"));
  const defineArg = hasAuth ? `{ middleware: [authMiddleware] }` : `{}`;

  return `/**
 * Routes — "${domainName}" domain.
 * AUTO-GENERATED by generate-complex-routes.ts
 */
import { z } from "zod";
import { defineRoutes } from "../../../src/base";
${d.extraImports.join("\n")}

// --- Schemas & shared types ---

${d.topLevel.join("\n\n")}

// --- Route definitions ---

export const ${exportName} = defineRoutes(${defineArg})({${d.routes
    .map(renderRoute)
    .join("\n")}
});
`;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function main() {
  // 1. Clean the directory to avoid orphaned files between generated runs
  if (existsSync(OUT_DIR)) {
    rmSync(OUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUT_DIR, { recursive: true });

  let totalRoutes = 0;
  const rootIndexImports: string[] = [];
  const rootIndexExports: string[] = [];

  // 2. Generate multiplied domains
  for (let i = 0; i < MULTIPLIER; i++) {
    const suffix = i === 0 ? "" : `_${i}`;

    for (const d of BASE_DOMAINS) {
      const targetDomain = `${d.domain}${suffix}`;
      const exportName = getExportName(targetDomain);

      const dir = join(OUT_DIR, targetDomain);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "index.ts"),
        renderDomainFile(targetDomain, d, exportName),
        "utf-8"
      );

      totalRoutes += d.routes.length;

      // Track imports and exports for root index
      rootIndexImports.push(
        `import { ${exportName} } from "./${targetDomain}";`
      );
      rootIndexExports.push(`  ${exportName},`);

      console.log(
        `[gen] src/routes/${targetDomain}/index.ts  (${d.routes.length} routes)`
      );
    }
  }

  // 3. Generate the root router index
  const rootIndexContent = `/**
 * Root Router Index
 * AUTO-GENERATED by generate-complex-routes.ts
 */

${rootIndexImports.join("\n")}

export const appRouter = {
${rootIndexExports.join("\n")}
};

export type AppRouter = typeof appRouter;
`;

  writeFileSync(join(OUT_DIR, "index.ts"), rootIndexContent, "utf-8");
  console.log(`[gen] src/routes/index.ts (Root Router)`);

  console.log(
    `\n✅  ${
      BASE_DOMAINS.length * MULTIPLIER
    } domains — ${totalRoutes} routes total generated (Multiplier: ${MULTIPLIER}x)`
  );
}

main();
