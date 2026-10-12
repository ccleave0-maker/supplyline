// Job notifications: what people on a job can be told about. Each job sets
// who gets which (job page › Notifications). Until it's set, the job's own
// people get the delivery notices.

export const NOTIFY_EVENTS = [
  { key: 'BOL_SHIPPED', label: 'BOL shipped — the truck has left', defaultOn: true },
  { key: 'BOL_DELIVERED', label: 'Delivered / received on site', defaultOn: true },
  { key: 'DELIVERY_PROBLEM', label: 'Short or damaged delivery', defaultOn: true },
  { key: 'DELIVERY_TOMORROW', label: 'Delivery tomorrow (reminder)', defaultOn: true },
  { key: 'DELIVERY_RESCHEDULED', label: 'Delivery date changed', defaultOn: true },
  { key: 'PO_ISSUED', label: 'PO issued for this job (packing list, no prices)', defaultOn: false },
  { key: 'PO_OVERDUE', label: 'PO overdue', defaultOn: false },
  { key: 'ORDER_SUBMITTED', label: 'Order list submitted', defaultOn: false },
] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number]['key'];
export const DEFAULT_NOTIFY_EVENTS: NotifyEvent[] = NOTIFY_EVENTS.filter((e) => e.defaultOn).map((e) => e.key);
export const isNotifyEvent = (k: string): k is NotifyEvent => NOTIFY_EVENTS.some((e) => e.key === k);
