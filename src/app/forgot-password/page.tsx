import SecurityForm from '../auth/SecurityForm';
import PremiumAuthLayout from '../auth/PremiumAuthLayout';

export default function ForgotPasswordPage() {
  return <PremiumAuthLayout compact><SecurityForm mode="forgot" /></PremiumAuthLayout>;
}
