import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · NutriBot"
};

// Public page: no session check. Linked from the Google OAuth consent screen.
export default function PrivacyPage() {
  return (
    <main className="shell">
      <section className="panel privacy">
        <h1>NutriBot privacy policy</h1>
        <p className="muted">Last updated October 8, 2026</p>

        <p>
          NutriBot is a private, personal app used by its owner only. It is not offered to the public and does not
          accept new accounts.
        </p>

        <h2>Data the app uses</h2>
        <ul>
          <li>Meals, macro estimates and nutrition goals entered in the app.</li>
          <li>
            Health and fitness data read from Google Health with read-only permission: daily activity totals, daily
            health metrics such as resting heart rate and HRV, sleep, and workout summaries.
          </li>
        </ul>

        <h2>How it is used and stored</h2>
        <ul>
          <li>Data is stored in a private database and used only to show the owner their own records and trends.</li>
          <li>
            Meal descriptions are sent to an AI model provider to estimate nutrition. Health data is not sold, used
            for advertising, or shared with anyone else.
          </li>
          <li>
            Use of information received from Google APIs adheres to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy">
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </li>
        </ul>

        <h2>Removing access and data</h2>
        <p>
          Google access can be revoked at any time from{" "}
          <a href="https://myaccount.google.com/permissions">Google Account permissions</a>. Stored data can be deleted
          on request to the owner at ejflynn27@gmail.com.
        </p>
      </section>
    </main>
  );
}
