import AuthForm from '../auth/AuthForm';
import PremiumAuthLayout from '../auth/PremiumAuthLayout';

export default function SignInPage() {
  return <PremiumAuthLayout><AuthForm mode="signin" /></PremiumAuthLayout>;
}
