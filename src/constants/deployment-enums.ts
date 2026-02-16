// packages/constants/src/deployment-enums.ts
// NOTE: DEPLOYMENT_STATUS, DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_TRIGGER, and DEPLOYMENT_APPLICATION
// are defined in enums.ts (the canonical source). This file only defines DEPLOYMENT_TYPE
// which is unique to this file.

export { DEPLOYMENT_STATUS, DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_TRIGGER, DEPLOYMENT_APPLICATION } from "./enums";

export enum DEPLOYMENT_TYPE {
  FULL = 'FULL',
  INCREMENTAL = 'INCREMENTAL',
  HOTFIX = 'HOTFIX',
  ROLLBACK = 'ROLLBACK',
}
