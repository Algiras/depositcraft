const PREFIX = 'depositcraft';

export function depositTriggerId(ruleId: string): string {
  return `${PREFIX}-${ruleId}`;
}

export function depositTriggerName(ruleName: string): string {
  return `DepositCraft: ${ruleName}`;
}
