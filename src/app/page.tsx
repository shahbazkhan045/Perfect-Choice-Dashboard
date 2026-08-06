import { currentRole, tokensConfigured } from '@/lib/auth';
import Dashboard from '@/components/Dashboard';
import { ROLE_LABELS } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const role = await currentRole();

  if (!role) {
    return <AccessGate configured={tokensConfigured()} />;
  }

  return <Dashboard role={role} roleLabel={ROLE_LABELS[role]} />;
}

function AccessGate({ configured }: { configured: boolean }) {
  return (
    <main className="gate">
      <div className="gate-card">
        <div className="gate-emoji" aria-hidden="true">
          🔒
        </div>
        <h1>Access link required</h1>

        {configured ? (
          <p>
            This dashboard opens through a personal access link. Please use the link that was
            shared with you, or contact the Justlife team for a new one.
          </p>
        ) : (
          <>
            <p>
              No access tokens are configured yet, so nobody can sign in. Set{' '}
              <code>TOKEN_JUSTLIFE_ADMIN</code>, <code>TOKEN_PC_ADMIN</code> and{' '}
              <code>TOKEN_VIEWER</code> in your environment variables, then redeploy.
            </p>
            <p className="gate-hint">
              Run <code>npm run tokens</code> locally to generate three strong values.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
