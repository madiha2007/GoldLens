
"use client";

import { useState } from "react";

export default function SupabaseTestPage() {
  const [status, setStatus] = useState("Not tested");

  async function testConnection() {
    setStatus("Connecting...");

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!url || !key) {
        setStatus("Error: Environment variables are missing.");
        return;
      }

      const response = await fetch(`${url}/rest/v1/`, {
        method: "GET",
        headers: {
          apikey: key,
        },
      });

      if (response.ok) {
        setStatus("Success! Supabase is reachable.");
      } else {
        setStatus(`Request failed: HTTP ${response.status}`);
      }
    } catch (error) {
      setStatus(
        "Connection failed. Check your URL, internet, and environment variables."
      );
    }
  }

  return (
    <main style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1>GoldLens - Supabase Connection Test</h1>

      <button onClick={testConnection}>
        Test Supabase Connection
      </button>

      <p>{status}</p>
    </main>
  );
}
