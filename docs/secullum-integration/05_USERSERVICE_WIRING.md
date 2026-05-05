# UserService → Secullum wiring (3-line patch)

`UserSecullumSyncService` is decoupled from `UserService` via `@nestjs/event-emitter`.
No circular-dependency risk — UserModule does not import SecullumModule.

## Step 1 — UserModule (no change required if `EventEmitterModule.forRoot()`
already lives at the app root)

Confirm `apps/api/src/app.module.ts` calls `EventEmitterModule.forRoot()`. If
not, add it once at app root:

```ts
// apps/api/src/app.module.ts
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    // …existing imports…
  ],
})
export class AppModule {}
```

## Step 2 — UserService

In `apps/api/src/modules/people/user/user.service.ts`:

### 2a. Inject `EventEmitter2` into the constructor

```ts
import { EventEmitter2 } from '@nestjs/event-emitter';
// …other imports…
import {
  SECULLUM_USER_CREATED_EVENT,
  SECULLUM_USER_UPDATED_EVENT,
} from '@modules/integrations/secullum/user-secullum-sync.service';

constructor(
  private readonly prisma: PrismaService,
  // …existing deps…
  private readonly eventEmitter: EventEmitter2,
) {}
```

### 2b. After `create()` transaction commits — emit event

Find the line in `async create(...)` (around L632–L730) where the transaction
finishes successfully and the user object is in scope. Right BEFORE the
`return` of the success path, add:

```ts
// Fire-and-forget: mirror to Secullum if the operator opted in.
this.eventEmitter
  .emit(SECULLUM_USER_CREATED_EVENT, { userId: user.id });
```

### 2c. After `update()` transaction commits — emit event with dismissal flag

Find the success path in `async update(...)` (around L752–L1080). Add:

```ts
const dismissalJustHappened =
  !existingUser.dismissalDate &&
  !!(updatedUser as { dismissalDate?: Date | null }).dismissalDate;

this.eventEmitter.emit(SECULLUM_USER_UPDATED_EVENT, {
  userId: id,
  dismissalJustHappened,
});
```

(Adjust `existingUser.dismissalDate` / `updatedUser.dismissalDate` to whatever
this codebase actually calls the field — search for `dismissedAt` or
`dismissalDate` in the User Prisma model & UserUpdateFormData schema.)

## Step 3 — UserService delete (optional)

Hard-delete in Ankaa should NOT hard-delete in Secullum (hard delete needs an
operator password — see `04_LIVE_TEST_FINDINGS.md` §D). Best practice: make
delete a soft-dismiss in Secullum:

```ts
// In async delete(...)
this.eventEmitter.emit(SECULLUM_USER_UPDATED_EVENT, {
  userId: id,
  dismissalJustHappened: true,
});
```

## Step 4 — Web form

The `secullumSyncEnabled` field is already in `userCreateSchema` /
`userUpdateSchema`? If not, add to `apps/web/src/schemas/user.ts`:

```ts
secullumSyncEnabled: z.boolean().default(false),
```

Then the existing `<SecullumSyncSwitch />` component picks it up.

## Step 5 — Initial bootstrap mapping

Run once after the migration to back-fill `secullumDepartamentoId` and
`secullumFuncaoId`. Example script: `scripts/secullum/initial-mapping.ts`

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { SecullumCadastrosService } from '@modules/integrations/secullum/secullum-cadastros.service';
import { PrismaService } from '@modules/common/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const cad = app.get(SecullumCadastrosService);
  const prisma = app.get(PrismaService);

  const [departamentos, funcoes, sectors, positions] = await Promise.all([
    cad.listDepartamentos(),
    cad.listFuncoes(),
    prisma.sector.findMany(),
    prisma.position.findMany(),
  ]);

  for (const { sector, departamento } of cad.matchDepartamentos(sectors, departamentos)) {
    if (sector) {
      await prisma.sector.update({
        where: { id: sector.id },
        data: { secullumDepartamentoId: departamento.Id },
      });
      console.log(`✔ ${sector.name} → Departamento ${departamento.Id}`);
    } else {
      console.log(`✘ unmatched Secullum departamento: ${departamento.Descricao}`);
    }
  }

  for (const { position, funcao } of cad.matchFuncoes(positions, funcoes)) {
    if (position) {
      await prisma.position.update({
        where: { id: position.id },
        data: { secullumFuncaoId: funcao.Id },
      });
      console.log(`✔ ${position.name} → Função ${funcao.Id}`);
    } else {
      console.log(`✘ unmatched Secullum função: ${funcao.Descricao}`);
    }
  }

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

## Smoke-test checklist

1. `pnpm db:migrate:deploy` (applies `add_secullum_mapping_ids`).
2. Run the bootstrap script above.
3. Create a test Ankaa user with `secullumSyncEnabled: true` + valid CPF +
   sector mapped to a Secullum departamento + position mapped to a Secullum
   função. Watch logs for `[secullum] user X ↔ Funcionario Y linked`.
4. Edit the user (change phone) — watch for `Funcionario Y updated`.
5. Set the user's dismissal date — watch for `Funcionario Y updated + dismissed`.
6. Verify in Secullum UI that the funcionário no longer appears in
   `/funcionarios` (active list).
