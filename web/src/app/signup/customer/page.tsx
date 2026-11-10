import { redirect } from 'next/navigation';

// Customer signup is now the simple form on /signup.
export default function CustomerSignupPage() {
  redirect('/signup');
}
