// packages/schemas/src/index.ts

export * from "./common";
export * from "./activity";
export * from "./activity-url-state";
export * from "./timeClockEntry";
export * from "./airbrushing";
export * from "./borrow";
export * from "./changelog";
export * from "./customer";
export * from "./cut";
export * from "./epi";
export * from "./externalWithdrawal";
export * from "./file";
export * from "./garage";
export * from "./holiday";
export * from "./item";
export * from "./maintenance";
export * from "./measure";
export * from "./notification";
export * from "./notification-preference";
export * from "./observation";
export * from "./order-rule";
export * from "./order-schedule";
// Order exports (excluding order-schedule duplicates)
export {
  orderIncludeSchema,
  orderItemIncludeSchema,
  orderOrderBySchema,
  orderItemOrderBySchema,
  orderWhereSchema,
  orderItemWhereSchema,
  orderGetManySchema,
  orderItemGetManySchema,
  orderCreateSchema,
  orderUpdateSchema,
  orderItemCreateSchema,
  orderItemUpdateSchema,
  orderBatchCreateSchema,
  orderBatchUpdateSchema,
  orderBatchDeleteSchema,
  orderItemBatchCreateSchema,
  orderItemBatchUpdateSchema,
  orderItemBatchDeleteSchema,
  orderGetByIdSchema,
  orderItemGetByIdSchema,
  orderQuerySchema,
  orderItemQuerySchema,
  mapOrderToFormData,
  mapOrderItemToFormData,
  // Types
  type OrderGetManyFormData,
  type OrderGetByIdFormData,
  type OrderQueryFormData,
  type OrderCreateFormData,
  type OrderUpdateFormData,
  type OrderBatchCreateFormData,
  type OrderBatchUpdateFormData,
  type OrderBatchDeleteFormData,
  type OrderInclude,
  type OrderOrderBy,
  type OrderWhere,
  type OrderItemGetManyFormData,
  type OrderItemGetByIdFormData,
  type OrderItemQueryFormData,
  type OrderItemCreateFormData,
  type OrderItemUpdateFormData,
  type OrderItemBatchCreateFormData,
  type OrderItemBatchUpdateFormData,
  type OrderItemBatchDeleteFormData,
  type OrderItemInclude,
  type OrderItemOrderBy,
  type OrderItemWhere,
} from "./order";
export * from "./paint";
export {
  physicalPersonIncludeSchema,
  physicalPersonOrderBySchema,
  physicalPersonWhereSchema,
  physicalPersonGetManySchema,
  physicalPersonGetByIdSchema,
  physicalPersonCreateSchema,
  physicalPersonQuickCreateSchema,
  physicalPersonUpdateSchema,
  physicalPersonBatchCreateSchema,
  physicalPersonBatchUpdateSchema,
  physicalPersonBatchDeleteSchema,
  physicalPersonQuerySchema,
  physicalPersonBatchQuerySchema,
  mapPhysicalPersonToFormData,
  type PhysicalPersonGetManyFormData,
  type PhysicalPersonGetByIdFormData,
  type PhysicalPersonQueryFormData,
  type PhysicalPersonBatchQueryFormData,
  type PhysicalPersonCreateFormData,
  type PhysicalPersonQuickCreateFormData,
  type PhysicalPersonUpdateFormData,
  type PhysicalPersonBatchCreateFormData,
  type PhysicalPersonBatchUpdateFormData,
  type PhysicalPersonBatchDeleteFormData,
  type PhysicalPersonInclude,
  type PhysicalPersonOrderBy,
  type PhysicalPersonWhere,
} from "./physical-person";
export * from "./position";
export * from "./preferences";
export * from "./secullum";
export * from "./warning";
export * from "./sector";
// Service exports (to avoid naming conflicts with serviceOrder)
export {
  serviceIncludeSchema,
  serviceOrderBySchema,
  serviceWhereSchema,
  serviceGetManySchema,
  serviceGetByIdSchema,
  serviceCreateSchema,
  serviceUpdateSchema,
  serviceBatchCreateSchema,
  serviceBatchUpdateSchema,
  serviceBatchDeleteSchema,
  serviceQuerySchema,
  mapServiceToFormData,
  // Types
  type ServiceGetManyFormData,
  type ServiceGetByIdFormData,
  type ServiceQueryFormData,
  type ServiceCreateFormData,
  type ServiceUpdateFormData,
  type ServiceBatchCreateFormData,
  type ServiceBatchUpdateFormData,
  type ServiceBatchDeleteFormData,
  type ServiceInclude,
  type ServiceOrderBy,
  type ServiceWhere,
} from "./service";
export * from "./serviceOrder";
export * from "./supplier";
export * from "./task";
export * from "./truck";
export * from "./layout";
export * from "./user";
export * from "./vacation";
export * from "./dashboard";
export * from "./auth";
export * from "./server";
export * from "./bonus";
export * from "./bonusDiscount";
export * from "./payroll";
// Discount exports (to avoid naming conflicts with payroll and bonusDiscount)
export {
  discountIncludeSchema,
  calculationOrderBySchema as discountOrderBySchema,
  discountWhereSchema,
  discountGetManySchema,
  discountGetByIdSchema,
  discountQuerySchema,
  mapToDiscountFormData,
  // Types
  type DiscountGetManyFormData,
  type DiscountGetByIdFormData,
  type DiscountQueryFormData,
  type DiscountInclude,
  type DiscountOrderBy,
  type DiscountWhere,
} from "./discount";
export * from "./statistics";
export * from "./deployment";
// export * from "./driver"; // Disabled - not currently used
