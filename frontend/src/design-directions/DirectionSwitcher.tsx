import { ArrowDownRight, ArrowRight, Command, Layers3, Network, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

const directions = [
  {
    id: "a",
    name: "Precision",
    reference: "A · Linear-inspired",
    description: "A crisp, keyboard-first workspace for people who like their tools quiet and quick.",
    traits: ["Focused", "Compact", "Clear"],
    icon: Command,
    swatches: ["#6d63d9", "#f7f8fa", "#20232a"],
  },
  {
    id: "b",
    name: "Workspace",
    reference: "B · Notion-inspired",
    description: "A warmer, more spacious notebook that gives your words the room they need.",
    traits: ["Warm", "Expressive", "Open"],
    icon: Layers3,
    swatches: ["#b56d4c", "#fbf8f2", "#302d29"],
  },
  {
    id: "c",
    name: "Graph",
    reference: "C · Obsidian-inspired",
    description: "A connected thinking space where ideas feel like part of a living constellation.",
    traits: ["Connected", "Atmospheric", "Electric"],
    icon: Network,
    swatches: ["#b34bf2", "#e5e8eb", "#20272e"],
  },
];

export function DirectionSwitcher() {
  return (
    <main className="switcher-page">
      <header className="switcher-topbar">
        <Link className="brand-lockup" to="/design" aria-label="Notez design directions home">
          <span className="brand-mark"><Sparkles size={16} strokeWidth={2.2} /></span>
          <span>notez<span className="brand-period">.</span></span>
        </Link>
        <span className="version-pill">DESIGN EXPLORATION <span>01</span></span>
      </header>

      <section className="switcher-hero">
        <div className="eyebrow"><span className="eyebrow-line" /> A place for your thoughts</div>
        <h1>Three ways to<br /><span>make space.</span></h1>
        <p>Same notes. Three different feelings. Step inside each direction and see which one feels like yours.</p>
        <a className="scroll-cue" href="#directions"><ArrowDownRight size={15} /> EXPLORE DIRECTIONS</a>
        <div className="hero-orbit orbit-one" />
        <div className="hero-orbit orbit-two" />
        <div className="hero-orbit orbit-three" />
        <div className="hero-sparkle sparkle-one">✳</div>
        <div className="hero-sparkle sparkle-two">✳</div>
      </section>

      <section id="directions" className="direction-grid">
        {directions.map(({ id, name, reference, description, traits, icon: Icon, swatches }, index) => (
          <article className={`direction-card direction-card-${id}`} key={id}>
            <div className="card-meta">
              <span>{reference}</span>
              <span className="card-index">0{index + 1}</span>
            </div>
            <div className="direction-preview" aria-hidden="true">
              <div className="preview-sidebar">
                <span className="preview-logo" />
                <span className="preview-row preview-row-active" />
                <span className="preview-row" />
                <span className="preview-row preview-row-short" />
              </div>
              <div className="preview-document">
                <span className="preview-kicker" />
                <span className="preview-title" />
                <span className="preview-line" />
                <span className="preview-line preview-line-short" />
                <span className="preview-highlight" />
                <span className="preview-line preview-line-mid" />
              </div>
              <div className="preview-orb"><Icon size={18} strokeWidth={1.7} /></div>
            </div>
            <div className="direction-card-copy">
              <h2>{name}</h2>
              <p>{description}</p>
              <div className="trait-list">
                {traits.map((trait) => <span key={trait}>{trait}</span>)}
              </div>
              <div className="card-footer">
                <div className="swatch-list" aria-label="Color palette">
                  {swatches.map((color) => <span key={color} style={{ backgroundColor: color }} />)}
                </div>
                <Link className="enter-direction" to={`/design/${id}`}>
                  Explore direction <ArrowRight size={15} />
                </Link>
              </div>
            </div>
          </article>
        ))}
      </section>
      <footer className="switcher-footer">
        <span>NOTEZ AI · A THOUGHTFUL PLACE TO KEEP THINGS</span>
        <span>15 notes <span className="footer-dot">·</span> 3 directions <span className="footer-dot">·</span> one good choice</span>
      </footer>
    </main>
  );
}
