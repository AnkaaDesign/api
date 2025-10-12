# Statistics Module

Comprehensive NestJS backend statistics endpoints for business intelligence and analytics across all business areas.

## Quick Start

### 1. Import the Module

Add the `StatisticsModule` to your app module:

```typescript
import { Module } from '@nestjs/common';
import { StatisticsModule } from './modules/system/statistics';

@Module({
  imports: [
    // ... other modules
    StatisticsModule,
  ],
})
export class AppModule {}
```

### 2. Access Endpoints

All endpoints are available at `/api/statistics/*`. See [ENDPOINTS_SUMMARY.md](./ENDPOINTS_SUMMARY.md) for complete documentation.

### 3. Example Usage

```typescript
// GET /api/statistics/inventory/overview
// Query: ?startDate=2024-01-01&endDate=2024-12-31&categoryId=abc-123

// Response:
{
  "success": true,
  "message": "Inventory overview retrieved successfully",
  "data": {
    "totalItems": 1523,
    "totalValue": 284750.50,
    "lowStockItems": 42,
    "criticalItems": 8,
    // ... more fields
  },
  "metadata": {
    "generatedAt": "2024-10-12T10:30:00Z",
    "period": {
      "from": "2024-01-01T00:00:00Z",
      "to": "2024-12-31T23:59:59Z"
    }
  }
}
```

## Features

### ✅ Real Database Data
- All statistics pulled from PostgreSQL via Prisma ORM
- No mocked data
- Real-time calculations

### ✅ Advanced Filtering
- Date range filtering
- Multi-criteria filtering
- Entity-specific filters (category, supplier, sector, etc.)
- Status-based filtering

### ✅ Comprehensive Coverage
- **Inventory**: 6 endpoints
- **Production**: 6 endpoints
- **Orders**: 5 endpoints
- **HR**: 5 endpoints
- **Financial**: 4 endpoints
- **Total**: 32 endpoints

### ✅ Authentication & Authorization
- JWT-based authentication
- Role-based access control
- Sector privilege validation

### ✅ Type Safety
- Full TypeScript support
- Validated DTOs
- Type-safe interfaces

### ✅ API Documentation
- Swagger/OpenAPI integration
- Comprehensive JSDoc comments
- Detailed interface documentation

## Architecture

```
statistics/
├── statistics.controller.ts      # Main controller with all endpoints
├── statistics.module.ts          # Module configuration
├── dto/
│   ├── query-statistics.dto.ts   # Input validation DTOs
│   └── statistics-response.dto.ts # Response type definitions
├── interfaces/
│   └── statistics.interface.ts   # TypeScript interfaces
├── services/
│   ├── inventory-statistics.service.ts
│   ├── production-statistics.service.ts
│   ├── orders-statistics.service.ts
│   ├── hr-statistics.service.ts
│   └── financial-statistics.service.ts
├── index.ts                      # Public exports
├── README.md                     # This file
└── ENDPOINTS_SUMMARY.md         # Complete endpoint documentation
```

## Business Areas Covered

### 1. Inventory Statistics
- Overview with stock health metrics
- Stock level analysis with status classification
- Consumption trends and patterns
- ABC/XYZ inventory classification
- Reorder point analysis
- Supplier performance evaluation

### 2. Production Statistics
- Task overview and status breakdown
- Completion rates and on-time performance
- Cycle time analysis
- Bottleneck identification
- Sector performance metrics
- Paint usage and cost tracking

### 3. Order Statistics
- Order overview and spending analysis
- Fulfillment rate tracking
- Supplier comparison
- Spending analysis by category
- Delivery performance metrics

### 4. HR Statistics
- Employee overview and demographics
- Performance metrics and distribution
- Bonus distribution analysis
- Attendance trends
- Warning analytics

### 5. Financial Statistics
- Revenue trends and growth
- Cost analysis by category
- Profitability metrics
- Budget tracking and alerts

## Usage Examples

### Inventory Overview
```bash
curl -X GET \
  'http://localhost:3000/api/statistics/inventory/overview?startDate=2024-01-01&endDate=2024-12-31' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Production Completion Rates
```bash
curl -X GET \
  'http://localhost:3000/api/statistics/production/completion-rates?period=month&sectorId=sector-123' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Financial Profitability
```bash
curl -X GET \
  'http://localhost:3000/api/statistics/financial/profitability?topN=20' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

## Query Parameters

### Common Parameters

Most endpoints support these parameters:

- `startDate` (ISO 8601): Start of date range
- `endDate` (ISO 8601): End of date range
- `period`: Aggregation period (`day`, `week`, `month`, `quarter`, `year`)
- `groupBy`: Grouping field
- `limit`: Maximum results (pagination)
- `offset`: Skip results (pagination)

### Entity Filters

- `categoryId`: Filter by item category
- `brandId`: Filter by item brand
- `supplierId`: Filter by supplier
- `sectorId`: Filter by production sector
- `customerId`: Filter by customer
- `userId`: Filter by user

### Advanced Filters

- `statuses`: Array of status values
- `topN`: Limit to top N results
- `minOrders`: Minimum order count threshold
- `filter`: Pre-defined filter preset

## Response Format

All endpoints return a consistent response structure:

```typescript
{
  success: boolean;
  message: string;
  data: <TypedData>;
  metadata?: {
    generatedAt: Date;
    period: {
      from: Date | null;
      to: Date | null;
    };
    filters?: Record<string, any>;
  };
}
```

## Error Handling

Standard HTTP status codes:

- `200 OK`: Successful request
- `400 Bad Request`: Invalid parameters
- `401 Unauthorized`: Missing/invalid authentication
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

Error response format:

```typescript
{
  success: false;
  message: "Error description";
  error?: "Detailed error message";
}
```

## Performance Considerations

### Database Optimization
- Efficient Prisma queries with field selection
- Database-level aggregations
- Indexed fields for filtering
- Batch operations where possible

### Recommended Indexes
```sql
-- Activity table
CREATE INDEX idx_activity_created_at ON "Activity"("createdAt");
CREATE INDEX idx_activity_item_id ON "Activity"("itemId");

-- Task table
CREATE INDEX idx_task_created_at ON "Task"("createdAt");
CREATE INDEX idx_task_status ON "Task"("status");
CREATE INDEX idx_task_sector_id ON "Task"("sectorId");

-- Order table
CREATE INDEX idx_order_created_at ON "Order"("createdAt");
CREATE INDEX idx_order_supplier_id ON "Order"("supplierId");

-- Item table
CREATE INDEX idx_item_category_id ON "Item"("categoryId");
CREATE INDEX idx_item_brand_id ON "Item"("brandId");
```

### Caching (Future Enhancement)
Consider adding Redis caching for:
- Overview statistics (5-15 min TTL)
- Aggregated metrics (1 hour TTL)
- Historical data (24 hour TTL)

## Testing

### Unit Tests
```bash
npm run test statistics.service
```

### Integration Tests
```bash
npm run test:e2e statistics.controller
```

### Manual Testing
Use the provided Swagger UI at `/api/docs` to test all endpoints interactively.

## Security

### Authentication Required
All endpoints require a valid JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### Role-Based Access
Each endpoint specifies required roles:

- `ADMIN`: Full access to all statistics
- `WAREHOUSE`: Inventory and order statistics
- `PRODUCTION`: Production statistics
- `LEADER`: Cross-functional statistics
- `HUMAN_RESOURCES`: HR statistics

### Data Privacy
- Users can only access data relevant to their role
- Sensitive financial data restricted to admins
- Personal employee data protected

## Extending the Module

### Adding New Endpoints

1. **Create Service Method**
```typescript
// In appropriate service file
async getNewStatistic(query: NewQueryDto): Promise<NewResponse> {
  // Implementation
}
```

2. **Create DTOs**
```typescript
// In query-statistics.dto.ts
export class NewQueryDto extends BaseStatisticsQueryDto {
  @IsOptional()
  @IsString()
  customFilter?: string;
}
```

3. **Add Controller Endpoint**
```typescript
// In statistics.controller.ts
@Get('category/new-statistic')
@Roles(SECTOR_PRIVILEGES.ADMIN)
async getNewStatistic(@Query(ValidationPipe) query: NewQueryDto) {
  const data = await this.service.getNewStatistic(query);
  return { success: true, message: 'Success', data };
}
```

4. **Update Documentation**
- Add to ENDPOINTS_SUMMARY.md
- Update this README

### Custom Aggregations

Extend the base services with custom business logic:

```typescript
import { InventoryStatisticsService } from './services/inventory-statistics.service';

@Injectable()
export class CustomInventoryService extends InventoryStatisticsService {
  async customAnalysis(params: CustomParams) {
    // Custom implementation
  }
}
```

## Troubleshooting

### No Data Returned
- Check date range parameters
- Verify filters match existing data
- Check user permissions

### Slow Queries
- Review query filters
- Check database indexes
- Consider adding pagination
- Review Prisma query execution plan

### Type Errors
- Ensure DTOs are properly imported
- Verify interface definitions
- Check TypeScript version compatibility

## Support

For issues or questions:
1. Check [ENDPOINTS_SUMMARY.md](./ENDPOINTS_SUMMARY.md) for detailed documentation
2. Review this README for implementation guidance
3. Consult the inline code documentation (JSDoc)
4. Check Prisma schema for data model details

## Version History

### v1.0.0 (2025-10-12)
- Initial implementation
- 32 endpoints across 5 business areas
- Full TypeScript support
- Comprehensive documentation

## License

[Your License Here]
