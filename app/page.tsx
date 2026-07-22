import {redirect} from 'next/navigation';

// The guided demo IS the primary screen. A full branded landing is R3; for now
// send visitors straight into it.
export default function Home() {
  redirect('/dashboard');
}
