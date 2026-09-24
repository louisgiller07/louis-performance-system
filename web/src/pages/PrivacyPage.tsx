import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PRIVACY_CONTACT_EMAIL, PRIVACY_NOTICE_VERSION, PRIVACY_OPERATOR } from "../features/privacy/privacyNotice";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-ink/80">{children}</div>
    </section>
  );
}

/** Public privacy notice (no authentication required). Describes only data NALYNT actually collects. */
export function PrivacyPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-6 bg-bg px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold uppercase tracking-widest text-gold">Nalynt</span>
        <Link to="/today" className="text-xs font-medium text-gold underline">
          Retour à l'application
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-ink">Confidentialité</h1>
        <p className="mt-1 text-xs text-muted">Version de la notice : {PRIVACY_NOTICE_VERSION}</p>
      </div>

      <Section title="Qui est responsable">
        <p>NALYNT est actuellement proposé dans le cadre d'un pilote restreint. Responsable du traitement :</p>
        <address className="not-italic">
          {PRIVACY_OPERATOR.name}
          {PRIVACY_OPERATOR.addressLines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
          <span className="block">{PRIVACY_CONTACT_EMAIL}</span>
        </address>
      </Section>

      <Section title="Ce que NALYNT collecte">
        <ul className="list-disc pl-5">
          <li>
            <strong>Compte</strong> : ton adresse email et les informations d'identification de ton compte (mot de passe géré par le
            service d'authentification, ou identité Google si tu te connectes avec Google).
          </li>
          <li>
            <strong>Profil sportif</strong> : discipline, niveau, objectifs, volume d'entraînement, jours de sortie préférés, niveau
            d'expérience en musculation, équipement, terrains accessibles, priorités techniques, limitations déclarées et objectif de
            saison.
          </li>
          <li>
            <strong>Planification</strong> : tes disponibilités hebdomadaires et les séances que tu planifies.
          </li>
          <li>
            <strong>Courses</strong> : les courses enregistrées pour toi (nom, dates, priorité, format).
          </li>
          <li>
            <strong>Check-ins quotidiens</strong> : sommeil, énergie, stress, motivation, fatigue des jambes et des mains, et les
            informations liées à ton état de santé du jour (voir ci-dessous).
          </li>
          <li>
            <strong>Entraînement</strong> : les plans générés pour toi, les décisions quotidiennes du coach et les séances que tu
            enregistres (statut, durée, effort perçu, fatigue, nouvelle douleur, remarques).
          </li>
          <li>
            <strong>Métadonnées techniques</strong> : des événements techniques (par exemple « plan généré », « séance enregistrée »,
            « erreur ») qui référencent des identifiants internes et des codes techniques.
          </li>
        </ul>
      </Section>

      <Section title="Données liées à la santé">
        <p>
          Tes check-ins peuvent contenir des informations de santé : douleur (intensité, localisation, apparition), maladie ou fièvre,
          fatigue et suspicion de commotion cérébrale. NALYNT les utilise uniquement pour adapter, alléger ou interrompre une séance
          d'entraînement, par exemple en recommandant du repos.
        </p>
        <p>
          NALYNT n'est pas un dispositif médical, ne pose aucun diagnostic et ne remplace pas un avis médical. En cas de douleur, de choc à la tête ou de doute, consulte
          un professionnel de santé.
        </p>
        <p>Ces données ne sont utilisées qu'avec ton consentement explicite, demandé avant ta première utilisation.</p>
      </Section>

      <Section title="Pourquoi">
        <ul className="list-disc pl-5">
          <li>t'identifier et sécuriser ton compte ;</li>
          <li>générer ton plan d'entraînement à partir de ton profil, de tes disponibilités et de tes courses ;</li>
          <li>adapter chaque jour ta séance à ton état du jour ;</li>
          <li>suivre tes séances réalisées et ton historique d'entraînement ;</li>
          <li>appliquer les règles de sécurité du coaching ;</li>
          <li>assurer le support technique pendant le pilote.</li>
        </ul>
      </Section>

      <Section title="Qui y a accès">
        <p>
          Toi, depuis ton compte : chaque athlète n'accède qu'à ses propres données. Les services techniques qui font fonctionner NALYNT
          (base de données, authentification et fonctions serveur chez Supabase, hébergement de l'application chez Vercel, et Google si
          tu utilises la connexion Google). L'équipe NALYNT, uniquement lorsque c'est nécessaire au support ou au bon fonctionnement du
          pilote.
        </p>
        <p>Tes données ne sont ni vendues ni partagées à des fins commerciales.</p>
      </Section>

      <Section title="Métadonnées techniques">
        <p>
          Les événements techniques servent à diagnostiquer les problèmes pendant le pilote. Ils référencent des identifiants internes
          (plan, séance, décision) et des codes d'erreur, mais ne recopient ni tes check-ins, ni tes prescriptions, ni tes remarques.
        </p>
      </Section>

      <Section title="Conservation et tes droits">
        <p>
          Tes données sont conservées tant que ton compte existe. Tu peux demander l'accès à tes données, leur correction ou la
          suppression de ton compte en écrivant à {PRIVACY_CONTACT_EMAIL}.
        </p>
      </Section>
    </div>
  );
}
