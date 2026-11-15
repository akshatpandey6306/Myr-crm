import SecurityForm from '../auth/SecurityForm';

export default async function ActivateAccountPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <SecurityForm mode="activate" token={token ?? ''} />;
}
