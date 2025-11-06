// app/go/tabs.tsx
import { Redirect } from 'expo-router';

export default function GoTabs() {
  // Redirige al index del grupo de tabs (ruta real: "/")
  return <Redirect href="/" />;
}
