import { useEffect } from 'react';
import heroVideo from '../ds.mp4';

type Step = {
  title: string;
  description: string;
};

type Feature = {
  icon: string;
  title: string;
  description: string;
};

type Role = {
  badge: string;
  title: string;
  items: string[];
  tone: 'green' | 'navy' | 'teal' | 'amber';
};

type Tier = {
  range: string;
  label: string;
  description: string;
  tone: 'low' | 'moderate' | 'high' | 'severe';
};

type TechItem = {
  tag: string;
  title: string;
  description: string;
};

const steps: Step[] = [
  {
    title: 'Bi-weekly check-in',
    description:
      'Employees complete two short sessions per week. A live webcam scan and a 5-10 question adaptive survey are done in minutes, from anywhere.',
  },
  {
    title: 'AI score computation',
    description:
      'Facial mood data and questionnaire responses are fused into a single Composite Depression Score (0-100) using a configurable weighted algorithm.',
  },
  {
    title: 'Tiered escalation',
    description:
      'Scores flow through a privacy-preserving hierarchy. Employees see trends; managers see anonymized aggregates; leaders see the full picture.',
  },
  {
    title: 'Action and support',
    description:
      'Flagged employees receive curated wellness resources, can access an AI venting assistant, or request a counselor session inside the platform.',
  },
];

const features: Feature[] = [
  {
    icon: '\u{1F441}',
    title: 'Facial expression analysis',
    description:
      'MediaPipe and a CNN classifier trained on RAF-DB and FER-2013 map facial action units to depressive indicators in real time.',
  },
  {
    icon: '\u{1F4CB}',
    title: 'Adaptive PHQ-9 questionnaire',
    description:
      'An intelligent 5-10 question survey that dynamically adjusts follow-ups based on prior answers for richer accuracy.',
  },
  {
    icon: '\u{1F4CA}',
    title: 'Personal trend dashboard',
    description:
      'Line charts, calendar heatmaps, and symptom frequency bars give employees a clear picture of their own mental health journey.',
  },
  {
    icon: '\u{1F91D}',
    title: 'Anonymous peer support board',
    description:
      'A moderated, fully anonymous community board where employees share and receive supportive responses from colleagues.',
  },
  {
    icon: '\u{1F916}',
    title: 'AI venting assistant',
    description:
      'Four response modes - Listen Only, Comfort Me, Help Me Think, Distract Me - powered by open-weight LLMs running locally.',
  },
  {
    icon: '\u{1F514}',
    title: 'Automated escalation alerts',
    description:
      'Managers are notified when employees hit consecutive Severe scores, department averages cross thresholds, or non-compliance spikes.',
  },
  {
    icon: '\u{1F3AF}',
    title: 'Wellness task assignment',
    description:
      'Managers can assign guided breathing sessions, CBT articles, or counselor appointments directly to flagged employees.',
  },
  {
    icon: '\u{1F3C6}',
    title: 'Gamified streak tracking',
    description:
      'Employees who maintain a 4-week unbroken check-in streak earn digital wellness badges displayed on their profile.',
  },
  {
    icon: '\u{1F3B5}',
    title: 'Distraction and comfort hub',
    description:
      'Breathing animations, ambient audio, mini-puzzles, and guided grounding exercises for moments of acute emotional heaviness.',
  },
];

const roles: Role[] = [
  {
    badge: 'Employee',
    title: 'Personal wellness hub',
    tone: 'green',
    items: [
      'Complete bi-weekly check-ins',
      'View your own score history and trends',
      'Access wellness resources and streaks',
      'Chat with the AI venting assistant',
      'Export session log as PDF',
    ],
  },
  {
    badge: 'Department Manager',
    title: 'Team oversight',
    tone: 'navy',
    items: [
      'Anonymized aggregate analytics',
      'Named detail for High and Severe cases',
      'Assign structured wellness tasks',
      'Submit formal reports to leadership',
      'Receive automated escalation alerts',
    ],
  },
  {
    badge: 'Company Head',
    title: 'Executive dashboard',
    tone: 'teal',
    items: [
      'Company-wide health status badge',
      'Review and act on manager reports',
      'Publish wellness event calendar',
      'Configure thresholds and score weights',
      'Auto-generated intervention recommendations',
    ],
  },
  {
    badge: 'Counselor (Optional)',
    title: 'Consultation queue',
    tone: 'amber',
    items: [
      'Receive High and Severe consultation requests',
      'Manage appointment scheduling',
      'End-to-end private session records',
      'Activated by System Admin configuration',
    ],
  },
];

const tiers: Tier[] = [
  {
    range: '0-25',
    label: 'Low',
    tone: 'low',
    description: 'No significant indicators. Employee continues normal check-in cycle with wellness resources.',
  },
  {
    range: '26-50',
    label: 'Moderate',
    tone: 'moderate',
    description: 'Mild indicators detected. Curated wellness resources and streak reminders are provided.',
  },
  {
    range: '51-75',
    label: 'High',
    tone: 'high',
    description: 'Manager alerted. Named detail view unlocked. Wellness tasks may be assigned.',
  },
  {
    range: '76-100',
    label: 'Severe',
    tone: 'severe',
    description: 'Immediate escalation. Counselor consultation prompted. Executive review triggered.',
  },
];

const techStack: TechItem[] = [
  {
    tag: 'Frontend',
    title: 'React + TailwindCSS',
    description: 'Deployed on Vercel for fast global delivery with TypeScript throughout.',
  },
  {
    tag: 'Backend',
    title: 'FastAPI + Python',
    description: 'High-performance async API server handling computer vision and ML microservices.',
  },
  {
    tag: 'Facial Analysis',
    title: 'MediaPipe + CNN',
    description: 'Real-time landmark extraction with a custom classifier trained on RAF-DB and FER-2013 datasets.',
  },
  {
    tag: 'AI Assistant',
    title: 'Llama 3 / Mistral',
    description: 'Open-weight LLMs served locally via Ollama with no API costs and full data privacy.',
  },
  {
    tag: 'Voice',
    title: 'OpenAI Whisper',
    description: 'Locally hosted speech-to-text for private voice note transcription and emotional summaries.',
  },
  {
    tag: 'Database',
    title: 'PostgreSQL + MongoDB',
    description: 'Structured session data in PostgreSQL; flexible document storage in MongoDB for logs.',
  },
];

function App() {
  useEffect(() => {
    const revealElements = document.querySelectorAll('.reveal');

    if (typeof window.IntersectionObserver === 'undefined') {
      revealElements.forEach((element) => element.classList.add('visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );

    revealElements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);

  return (
    <div className="page-shell">
      <header className="topbar">
        <a className="logo" href="#home" aria-label="MindWell home">
          Mind<span>Well</span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#roles">Who it is for</a>
          <a href="#scoring">Scoring</a>
          <a href="#tech">Tech</a>
        </nav>
        <a className="nav-cta" href="#contact">
          Request a Demo
        </a>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-video-wrap" aria-hidden="true">
            <video autoPlay muted loop playsInline>
              <source src={heroVideo} type="video/mp4" />
            </video>
          </div>

          <div className="hero-content">
            <div className="hero-pill">
              <span className="pill-dot" />
              AI-powered corporate wellness
            </div>
            <h1>
              Mental health support,
              <br />
              <em>built into your workplace</em>
            </h1>
            <p>
              MindWell detects early signs of depression using AI-powered facial analysis and adaptive
              questionnaires, helping organisations care for their people proactively.
            </p>
            <div className="hero-btns">
              <a className="btn-primary" href="#contact">
                Get Started
              </a>
              <a className="btn-ghost" href="#how">
                See how it works
              </a>
            </div>
            <div className="hero-stats">
              <div className="stat">
                <div className="stat-num">14</div>
                <div className="stat-label">Functional Features</div>
              </div>
              <div className="stat">
                <div className="stat-num">4</div>
                <div className="stat-label">Score Tiers</div>
              </div>
              <div className="stat">
                <div className="stat-num">5</div>
                <div className="stat-label">User Roles</div>
              </div>
              <div className="stat">
                <div className="stat-num">2x</div>
                <div className="stat-label">Weekly Check-ins</div>
              </div>
            </div>
          </div>

          <div className="scroll-hint">
            <span>Scroll</span>
            <div className="arrow-down" />
          </div>
        </section>

        <section id="how" className="content-section">
          <span className="section-label">How it works</span>
          <h2 className="section-title">
            Three steps to a <em>healthier</em> workplace
          </h2>
          <p className="section-sub">
            A seamless weekly flow that respects employee privacy while giving leadership the insight they need.
          </p>
          <div className="steps-grid reveal">
            {steps.map((step, index) => (
              <article className="step-card" key={step.title} style={{ transitionDelay: `${index * 90}ms` }}>
                <div className="step-num">{index + 1}</div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="features" className="content-section features-bg">
          <span className="section-label">Core features</span>
          <h2 className="section-title">
            Everything your team <em>needs</em>
          </h2>
          <p className="section-sub">
            From real-time facial scanning to executive dashboards, every layer of the organisation is covered.
          </p>
          <div className="features-grid reveal">
            {features.map((feature, index) => (
              <article className="feature-card" key={feature.title} style={{ transitionDelay: `${index * 70}ms` }}>
                <div className="feature-icon" aria-hidden="true">
                  {feature.icon}
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="roles" className="content-section">
          <span className="section-label">Who it is for</span>
          <h2 className="section-title">
            Built for every <em>level</em> of your organisation
          </h2>
          <p className="section-sub">Each role sees only what they need, privacy-preserving by design.</p>
          <div className="roles-grid reveal">
            {roles.map((role, index) => (
              <article className={`role-card ${role.tone}`} key={role.badge} style={{ transitionDelay: `${index * 70}ms` }}>
                <span className={`role-badge ${role.tone}`}>{role.badge}</span>
                <h3>{role.title}</h3>
                <ul>
                  {role.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section id="scoring" className="content-section scoring-section">
          <span className="section-label">Depression scoring</span>
          <h2 className="section-title">
            Four tiers, one <em>clear</em> picture
          </h2>
          <p className="section-sub">
            A composite score from 0-100 is computed from facial data (50%) and questionnaire responses (50%), then
            classified into one of four actionable tiers.
          </p>
          <div className="tiers-row reveal">
            {tiers.map((tier, index) => (
              <article className="tier" key={tier.label} style={{ transitionDelay: `${index * 70}ms` }}>
                <div className={`tier-bar ${tier.tone}`} />
                <div className="tier-range">{tier.range}</div>
                <div className={`tier-label ${tier.tone}`}>{tier.label}</div>
                <div className="tier-desc">{tier.description}</div>
              </article>
            ))}
          </div>
        </section>

        <section id="tech" className="content-section tech-section">
          <span className="section-label">Technology</span>
          <h2 className="section-title">
            Built with <em>purpose-built</em> tools
          </h2>
          <p className="section-sub">
            Open-source, privacy-respecting technology at every layer, with no vendor lock-in and no cloud API costs
            for AI.
          </p>
          <div className="tech-grid reveal">
            {techStack.map((item, index) => (
              <article className="tech-card" key={item.title} style={{ transitionDelay: `${index * 70}ms` }}>
                <span className="tech-tag">{item.tag}</span>
                <h4>{item.title}</h4>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="privacy-wrap">
          <div className="privacy-banner reveal">
            <div className="icon-wrap" aria-hidden="true">
              Lock
            </div>
            <div>
              <h3>Privacy-preserving by design</h3>
              <p>
                Employees see only their own data. Managers see anonymized aggregates, named detail only for High and
                Severe cases. Counselor records are end-to-end private and inaccessible to managers or company heads.
                Every access to sensitive views is logged in the audit trail.
              </p>
            </div>
          </div>
        </section>

        <section id="contact" className="cta-section reveal">
          <h2>
            Ready to build a <em>healthier</em> workplace?
          </h2>
          <p>
            Join forward-thinking organisations using MindWell to detect, respond, and prevent employee depression
            before it escalates.
          </p>
          <div className="cta-btns">
            <a className="btn-primary" href="#home">
              Request a Demo
            </a>
            <a className="btn-ghost" href="#tech">
              Read the Docs
            </a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div>
            <a className="logo footer-logo" href="#home">
              Mind<span>Well</span>
            </a>
            <p className="footer-tagline">AI-powered mental health support built for the modern workplace.</p>
          </div>
          <div className="footer-col">
            <h4>Product</h4>
            <ul>
              <li>
                <a href="#how">How it works</a>
              </li>
              <li>
                <a href="#features">Features</a>
              </li>
              <li>
                <a href="#scoring">Scoring tiers</a>
              </li>
              <li>
                <a href="#tech">Tech stack</a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Roles</h4>
            <ul>
              <li>
                <a href="#roles">Employee</a>
              </li>
              <li>
                <a href="#roles">Department Manager</a>
              </li>
              <li>
                <a href="#roles">Company Head</a>
              </li>
              <li>
                <a href="#roles">Counselor</a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Project</h4>
            <ul>
              <li>
                <a href="#home">BRAC University</a>
              </li>
              <li>
                <a href="#home">CSE471 - Spring 2026</a>
              </li>
              <li>
                <a href="#home">Group 11 - Lab 01</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>Copyright 2026 MindWell - BRAC University Group 11</p>
          <p>Rafi Al Mahmud (22201567) - Yaad Kamrul Bari (22201331) - Wardat Shams Iqbal (22201704)</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
