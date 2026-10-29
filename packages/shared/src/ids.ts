/** Entity IDs are strings so they double as Colyseus MapSchema keys. Prefix encodes the kind. */
export type EntityKind = 'player' | 'vehicle' | 'npc' | 'prop' | 'projectile';

const PREFIX: Record<EntityKind, string> = {
  player: 'p',
  vehicle: 'v',
  npc: 'n',
  prop: 'd',
  projectile: 'x',
};

export class EntityIdAllocator {
  private next = 1;
  constructor(private readonly zone = '') {}

  allocate(kind: EntityKind): string {
    const id = `${PREFIX[kind]}${this.zone ? `.${this.zone}` : ''}.${this.next.toString(36)}`;
    this.next++;
    return id;
  }
}

export function kindOf(id: string): EntityKind | undefined {
  const prefix = id.split('.')[0];
  return (Object.keys(PREFIX) as EntityKind[]).find((k) => PREFIX[k] === prefix);
}
