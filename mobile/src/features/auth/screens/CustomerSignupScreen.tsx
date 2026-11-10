import { Redirect } from 'expo-router';

// Customer signup is now the simple form on /signup.
export default function CustomerSignupScreen() {
  return <Redirect href="/signup" />;
}
