// Una sesión sola conserva su estado. El trabajo delegado mantiene ocupado al padre,
// y una sesión hija terminada devuelve el control a su coordinadora, no al usuario.
export function withRoles(sessions) {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const children = new Map();
  for (const session of sessions) {
    if (!session.parentId) continue;
    if (!children.has(session.parentId)) children.set(session.parentId, []);
    children.get(session.parentId).push(session.id);
  }
  const resolved = new Map();
  function activity(id, visiting = new Set()) {
    const session = byId.get(id);
    if (resolved.has(id)) return resolved.get(id);
    if (!session || visiting.has(id)) return { working: false, lastActivity: 0 };
    const next = new Set(visiting).add(id);
    const team = (children.get(id) ?? []).map((childId) => activity(childId, next));
    const helpers = (session.subagents ?? []).filter((agent) => agent.running);
    const delegated = team.some((child) => child.working) || helpers.length > 0;
    const result = {
      working: session.status === 'working' || delegated,
      delegated,
      lastActivity: Math.max(session.lastActivity, ...team.filter((child) => child.working).map((child) => child.lastActivity),
        ...helpers.map((agent) => agent.lastActivity)),
    };
    resolved.set(id, result);
    return result;
  }
  return sessions.map((session) => {
    const childIds = children.get(session.id) ?? [];
    const issue = /^(?:feature|fix|hotfix|bugfix)\/(\d+)/.exec(session.branch ?? '')?.[1] ?? /#(\d+)/.exec(session.title)?.[1] ?? null;
    const role = childIds.length ? 'coordinator' : session.parentId ? 'worker' : null;
    const team = activity(session.id);
    const completedForParent = !team.working && (session.status === 'yours' || session.status === 'done') && byId.has(session.parentId);
    return {
      ...session, role, childIds, issue: role === 'worker' ? issue : null,
      status: team.working ? 'working' : completedForParent ? 'idle' : session.status,
      ownStatus: session.status,
      waitingForTeam: team.delegated && session.status !== 'working',
      completedForParent,
      lastActivity: team.working ? team.lastActivity : session.lastActivity,
    };
  });
}

// Estado de un equipo (coordinadora y sus delegadas) para la vista Misiones: manda el miembro que
// más urge. Aprobación pendiente > te espera > trabajando > terminada > en pausa. Usa el estado ya resuelto:
// una coordinadora que espera a sus delegadas trabaja, y una delegada que acabó no te espera.
const TEAM_URGENCY = ['approval', 'yours', 'working', 'done', 'idle'];
export function teamStatus(members) {
  let best = TEAM_URGENCY.length - 1;
  for (const member of members) {
    const state = member.order?.approvals?.length ? 'approval'
      : member.completedForParent ? 'idle'
        : member.status === 'yours' ? 'yours'
          : member.status === 'working' ? 'working'
            : member.status === 'done' ? 'done' : 'idle';
    best = Math.min(best, TEAM_URGENCY.indexOf(state));
  }
  return TEAM_URGENCY[best];
}
