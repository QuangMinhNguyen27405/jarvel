import { useMemo, useState } from 'react';
import { createPlanApi, type PlanApi } from './api.js';
import type { Session } from './auth.js';
import { BrandMark } from './icons.js';
import { NewPlan } from './NewPlan.js';
import { PlanDetail } from './PlanDetail.js';
import { PlanList } from './PlanList.js';

type View = { name: 'list' } | { name: 'new' } | { name: 'plan'; planId: string };

export function App({ apiUrl, session, api: injected }: { apiUrl: string; session: Session; api?: PlanApi }) {
  const api = useMemo(() => injected ?? createPlanApi(apiUrl, session.getToken), [injected, apiUrl, session.getToken]);
  const [view, setView] = useState<View>({ name: 'list' });
  const toList = () => setView({ name: 'list' });
  const toNew = () => setView({ name: 'new' });
  const toPlan = (planId: string) => setView({ name: 'plan', planId });
  return (
    <div className="shell">
      <div className="airmail" aria-hidden="true" />
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="brand" onClick={toList}>
            <BrandMark />
          </button>
          <div className="topbar-user">
            <span className="topbar-name">{session.label}</span>
            <button type="button" className="btn btn-quiet" onClick={session.signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className={`page page--${view.name}`}>
        {view.name === 'list' && <PlanList api={api} onOpen={toPlan} onNew={toNew} />}
        {view.name === 'new' && <NewPlan api={api} onCancel={toList} onCreated={toPlan} />}
        {view.name === 'plan' && <PlanDetail api={api} planId={view.planId} onBack={toList} onNew={toNew} />}
      </main>
    </div>
  );
}
