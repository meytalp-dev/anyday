"use client";

import { useState, useEffect } from "react";

export default function Home() {
  const [mobileMenu, setMobileMenu] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // an attribute, not a class: React rewrites className on re-render
            // (e.g. opening a FAQ item) and would wipe the class - the item vanished.
            entry.target.setAttribute("data-reveal", "in");
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Counter animation
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          const target = parseInt(el.dataset.count || "0");
          let current = 0;
          const step = Math.ceil(target / 40);
          const timer = setInterval(() => {
            current += step;
            if (current >= target) { current = target; clearInterval(timer); }
            el.textContent = current.toString();
          }, 30);
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.5 });
    document.querySelectorAll("[data-count]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  function scrollToDemo() {
    window.location.href = "mailto:hello@anyday.co.il?subject=הזמנת דמו של 15 דקות";
  }

  return (
    <div dir="rtl" className="root">

      {/* ─── NAV ─── */}
      <nav className={`nav ${scrolled ? "nav--solid" : ""}`}>
        <a href="/" className="nav__logo">
          <span className="nav__mark">A</span>
          <span className="nav__name">AnyDay</span>
        </a>
        <div className="nav__links">
          {[["#features","יתרונות"],["#how","תהליך"],["#pricing","מחירים"]].map(([h,l]) => (
            <a key={h} href={h} className="nav__link">{l}</a>
          ))}
          <a href="/app" className="nav__enter">כניסה →</a>
        </div>
        <button className="nav__burger" onClick={() => setMobileMenu(!mobileMenu)} aria-label="תפריט">
          <span className={mobileMenu ? "x" : ""} />
          <span className={mobileMenu ? "x" : ""} />
        </button>
      </nav>

      {mobileMenu && (
        <div className="mob">
          {[["#features","יתרונות"],["#how","תהליך"],["#pricing","מחירים"]].map(([h,l],i) => (
            <a key={h} href={h} onClick={() => setMobileMenu(false)} className="mob__link" style={{animationDelay:`${i*.08}s`}}>{l}</a>
          ))}
          <a href="/app" className="mob__cta">כניסה למערכת</a>
        </div>
      )}

      {/* ─── HERO ─── */}
      <section className="hero">
        <div className="hero__bg">
          <div className="hero__orb hero__orb--1" />
          <div className="hero__orb hero__orb--2" />
          <div className="hero__grain" />
        </div>

        <div className="hero__inner">
          <div className="hero__text">
            <p className="hero__over reveal-up">לכל ארגון · Monday או גיליון</p>
            <h1 className="hero__h1">
              <span className="reveal-up" style={{animationDelay:".1s"}}>הנתונים שלכם כבר עובדים.</span>
              <span className="hero__accent reveal-up" style={{animationDelay:".2s"}}>אנחנו הופכים אותם לקריאים.</span>
            </h1>
            <p className="hero__sub reveal-up" style={{animationDelay:".35s"}}>
              מחברים את ה-Monday — או מעלים גיליון — ואוטומטית נבנה דשבורד עם תובנות. עם Monday מחובר גם פעולות שיוצאות החוצה וחוזרות ומתעדכנות בבורד עצמו. אפס הגדרות.
            </p>
            <div className="hero__btns reveal-up" style={{animationDelay:".5s"}}>
              <a href="/app" className="btn btn--lime">חברו את ה-Monday שלכם →</a>
              <a href="/sheet" className="btn btn--outline">יש לכם גיליון? העלו וראו מיד</a>
            </div>
            <p className="hero__audience reveal-up" style={{animationDelay:".6s"}}>למנכ״לים, מנהלי תפעול, ראשי צוותים ורכזי פרויקטים — במשרד עורכי דין, בחברת בנייה, בבית ספר או בעמותה</p>
          </div>

          {/* Floating Dashboard */}
          <div className="hero__visual reveal-up" style={{animationDelay:".4s"}}>
            <div className="dash">
              <div className="dash__bar">
                <div className="dash__dots"><i/><i/><i/></div>
                <span className="dash__url">app.anyday.co.il</span>
              </div>
              <div className="dash__body">
                <div className="dash__chat">
                  <div className="chat-q">מה דורש תשומת לב השבוע?</div>
                  <div className="chat-a">
                    <span className="chat-a__tag">AnyDay</span>
                    מצאתי <strong>3 פריטים תקועים ו-2 תאריכי יעד שעברו</strong>. רוצים שאסמן אותם ואשלח סיכום לצוות?
                    <div className="chat-a__bar">
                      <div className="chat-a__fill" />
                    </div>
                  </div>
                </div>
                <div className="dash__cards">
                  <div className="dash__card">
                    <span className="dash__card-label">פריטים פעילים</span>
                    <span className="dash__card-val dash__card-val--green">148</span>
                  </div>
                  <div className="dash__card">
                    <span className="dash__card-label">בורדים</span>
                    <span className="dash__card-val">6</span>
                  </div>
                  <div className="dash__card dash__card--alert">
                    <span className="dash__card-label">דורשים תשומת לב</span>
                    <span className="dash__card-val dash__card-val--red">3 פריטים</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Diagonal cut */}
        <div className="hero__cut" />
      </section>

      {/* ─── STATS RIBBON ─── */}
      <section className="stats">
        {[
          { num: 0, suffix: "", label: "הגדרות נדרשות" },
          { num: 2, suffix: " דק׳", label: "מהחיבור עד הדשבורד" },
          { num: 24, suffix: "/7", label: "זמין לצוות שלכם" },
          { num: 100, suffix: "%", label: "עברית טבעית" },
        ].map((s, i) => (
          <div key={i} className="stat" data-reveal>
            <div className="stat__num">
              <span data-count={s.num}>0</span>{s.suffix}
            </div>
            <div className="stat__label">{s.label}</div>
          </div>
        ))}
      </section>

      {/* ─── WHAT CAN YOU DO ─── */}
      <section className="capabilities">
        <div className="capabilities__header" data-reveal>
          <span className="tag">מה אפשר לעשות</span>
          <h2 className="big-title">ארבעה דברים.<br/>מקום אחד.</h2>
        </div>
        <div className="capabilities__grid">
          {[
            { icon: "📊", title: "דשבורד שנבנה לבד", desc: "מחברים את Monday או מעלים גיליון — AnyDay קוראת את העמודות ובונה תמונת מצב קריאה. אפס הגדרות." },
            { icon: "🔍", title: "תובנות, לא טבלאות", desc: "מה תקוע, מה עבר תאריך, מי עמוס — AnyDay מציפה את זה לבד, בלי שתחפשו." },
            { icon: "⚡", title: "פעולות שחוזרות פנימה", desc: "״כשפריט עובר ל׳הושלם׳ — עדכנו ושלחו סיכום.״ כלל בעברית, והעדכון נכתב חזרה ל-Monday." },
            { icon: "🏗️", title: "צריכים בורד חדש?", desc: "תארו אותו במילים ו-AnyDay תקים אותו — בלי לצאת מהמסך. נוחות, לא פרויקט הטמעה." },
          ].map((cap, i) => (
            <div key={i} className="cap-card" data-reveal style={{animationDelay: `${i * .1}s`}}>
              <span className="cap-card__icon">{cap.icon}</span>
              <h3 className="cap-card__title">{cap.title}</h3>
              <p className="cap-card__desc">{cap.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section id="features" className="features">
        <div className="features__header" data-reveal>
          <span className="tag">איך זה נראה בפועל</span>
          <h2 className="big-title">לא סתם<br/>עוד כלי.</h2>
        </div>

        {[
          {
            title: "30 בורדים.\nמה דורש אתכם היום?",
            desc: "AnyDay סורקת את כל המבנה, מזהה פריטים תקועים, שדות חסרים ובעיות מבניות — ומציעה תיקון מיידי.",
            visual: "alert",
          },
          {
            title: "אוטומציות\nבשפה שלכם.",
            desc: "\"כשפריט עובר ל׳הושלם׳ — עדכנו סטטוס ושלחו סיכום למנהל.\" הגדרתם כלל בעברית, AnyDay מפעילה אותו — והעדכון נכתב חזרה ל-Monday.",
            visual: "chat",
          },
          {
            title: "דוח להנהלה?\nשניות.",
            desc: "סיכום רבעוני, מצב פרויקטים, גרפי התקדמות — מוכן לפני הישיבה. מה שלקח חצי יום עבודה קורה בלחיצה.",
            visual: "report",
          },
          {
            title: "\"צריך בורד חדש.\nעכשיו.\"",
            desc: "תארו אותו במילים — ו-AnyDay מקימה בורד עם עמודות, קבוצות ואוטומציות, בלי לצאת מהמסך ובלי להיכנס ל-Monday. זו נוחות בתוך המוצר, לא פרויקט הטמעה.",
            visual: "build",
          },
        ].map((f, i) => (
          <div key={i} className={`feat ${i % 2 === 1 ? "feat--flip" : ""}`} data-reveal>
            <div className="feat__text">
              <span className="feat__num">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="feat__title">{f.title}</h3>
              <p className="feat__desc">{f.desc}</p>
            </div>
            <div className="feat__visual">
              <div className={`feat__box feat__box--${f.visual}`}>
                {f.visual === "chat" && (
                  <>
                    <div className="fv-bubble fv-bubble--q">כשסטטוס משתנה ל״הושלם״ — שלחו סיכום</div>
                    <div className="fv-bubble fv-bubble--a">לדוגמה: אוטומציה פעילה, 14 פריטים עודכנו החודש.</div>
                  </>
                )}
                {f.visual === "report" && (
                  <div className="fv-report">
                    <div className="fv-report__title">סיכום רבעוני Q1</div>
                    <div className="fv-bars">
                      <div className="fv-bar" style={{height: "60%"}} /><div className="fv-bar" style={{height: "80%"}} />
                      <div className="fv-bar" style={{height: "45%"}} /><div className="fv-bar fv-bar--accent" style={{height: "90%"}} />
                    </div>
                  </div>
                )}
                {f.visual === "alert" && (
                  <div className="fv-alerts">
                    <div className="fv-alert fv-alert--red"><span className="fv-dot fv-dot--red" />12 פריטים בלי בעל תפקיד</div>
                    <div className="fv-alert fv-alert--amber"><span className="fv-dot fv-dot--amber" />קבוצה ריקה: ״ארכיון 2024״</div>
                    <div className="fv-alert fv-alert--green"><span className="fv-dot fv-dot--green" />המבנה תוקן</div>
                  </div>
                )}
                {f.visual === "build" && (
                  <div className="fv-build">
                    <div className="fv-build__block fv-build__block--1" />
                    <div className="fv-build__block fv-build__block--2" />
                    <div className="fv-build__block fv-build__block--3" />
                    <div className="fv-build__label">בורד חדש</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* ─── HOW ─── */}
      <section id="how" className="how">
        <div className="how__header" data-reveal>
          <span className="tag tag--dark">איך זה עובד</span>
          <h2 className="big-title big-title--light">שתי דקות.<br/>אפס הגדרות.<br/>תמונת מצב קריאה.</h2>
        </div>

        <div className="timeline">
          <div className="timeline__line" />
          {[
            { num: "01", title: "חברו את Monday — או העלו גיליון", desc: "עם Monday: מאשרים גישה בלחיצה אחת, בלי טוקנים ובלי IT. עם גיליון: מדביקים קישור ל-Google Sheets — או גוררים קובץ CSV.", color: "var(--lime)" },
            { num: "02", title: "הדשבורד נבנה לבד", desc: "AnyDay קוראת את העמודות, מזהה מה חשוב ובונה תמונת מצב עם תובנות. אתם לא מגדירים כלום.", color: "var(--orange)" },
            { num: "03", title: "פעלו מתוך הדשבורד", desc: "עם Monday מחובר: עדכנו סטטוסים, שלחו סיכומים, קבלו דיגסט שבועי — הכל בעברית, והכל נכתב חזרה לבורד.", color: "var(--cyan)" },
          ].map((s, i) => (
            <div key={i} className="tl-step" data-reveal>
              <div className="tl-step__dot" style={{background: s.color}} />
              <div className="tl-step__num" style={{color: s.color}}>{s.num}</div>
              <h3 className="tl-step__title">{s.title}</h3>
              <p className="tl-step__desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── PRICING — Early Access ───
          ארבע המדרגות הקודמות לא נאכפו בשום מקום בקוד (MAX=2 סתר גם "בורד
          אחד" וגם "ללא הגבלה"), ויחידת התמחור עצמה — ארגון? משתמש? בורד? —
          עוד לא הוכרעה. מחירון שפורסם היה מבטיח משהו שהמוצר מפר ונועל החלטה
          שטרם התקבלה. מדרגה אחת כנה במקומו, עד שיש למי ולמה לתמחר. */}
      <section id="pricing" className="pricing">
        <div className="pricing__header" data-reveal>
          <span className="tag">מחירים</span>
          <h2 className="big-title">פיילוט ראשון. בואו לבנות אותו איתנו.</h2>
        </div>

        <div className="plans" style={{ gridTemplateColumns: "minmax(0, 440px)", justifyContent: "center" }}>
          <div className="plan plan--pop" data-reveal>
            <div className="plan__badge">Early Access</div>
            <h3 className="plan__name">מצטרפים מוקדם</h3>
            <div className="plan__price">
              <span className="plan__amount">0</span>
              <span className="plan__period">₪ בתקופת הפיילוט</span>
            </div>
            <ul className="plan__list">
              <li>כל היכולות: לוח חי, דוחות, אוטומציות, דיגסט</li>
              <li>ליווי צמוד בהקמה — אפס הגדרות באמת</li>
              <li>מתמחרים יחד, כשנדע מה שווה לכם</li>
              <li>מחיר מייסדים למצטרפים בתקופה הזו</li>
            </ul>
            <button onClick={scrollToDemo} className="btn btn--lime">להצטרף לפיילוט →</button>
          </div>
        </div>
      </section>

      {/* ─── TRUST ─── */}
      <section className="trust" data-reveal>
        <div className="trust__inner">
          {[
            /* "שרתים בישראל" הוסר: הפריסה היא fra1 — פרנקפורט (ראו vercel.json),
               ול-Vercel אין אזור בישראל כלל, כך שהטענה אינה "טרם הוגדרה" אלא
               בלתי ניתנת למימוש. הוחלף במה שנכון ובר-בדיקה. */
            /* "מחיקה מלאה בלחיצה" הוחלף: disconnect מוחק את הטוקן והחיבור —
               לא את הארגון וההגדרות. מבטיחים את מה שהכפתור באמת עושה; מחיקת
               כל נתוני הארגון היא פיצ'ר נפרד כשיהיה — לא סיסמה לפני כן. */
            "הצפנה AES-256","שרתים באיחוד האירופי","לא מאמנים על הנתונים שלכם","ניתוק Monday בלחיצה — הטוקן נמחק מיד",
          ].map((label,i) => (
            <div key={i} className="trust__item">
              <span className="trust__check">✓</span><span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className="faq-section">
        <div className="faq-section__header" data-reveal>
          <span className="tag">שאלות</span>
          <h2 className="big-title">שאלות שכולם שואלים.</h2>
        </div>
        <div className="faq-list">
          {[
            { q: "זה מתאים לארגון כמו שלנו?", a: "כן — עם Monday מחובר או עם גיליון שמעלים. AnyDay קוראת את הנתונים לפי טיפוסי העמודות ולא לפי התחום, ולכן משרד עורכי דין, חברת בנייה, בית ספר או עמותה מקבלים בדיוק את אותה תמונת מצב. צוות של 3 עם 5 בורדים או רשת עם 50 — אותו דבר." },
            { q: "מה צריך מהצד שלנו?", a: "אישור גישה ל-Monday בלחיצה אחת (בלי טוקנים) — או קובץ גיליון. בלי התקנות, בלי הגדרות, בלי לשנות כלום בבורדים. AnyDay מתחברת ולומדת את המבנה לבד." },
            { q: "אין לנו Monday — רק גיליון. זה עדיין רלוונטי?", a: "כן. מדביקים קישור לגיליון Google (או גוררים קובץ CSV) ומקבלים דשבורד באותו רגע — בלי חשבון. גיליון מקושר אפשר למשוך מחדש בכל רגע, כך שהתמונה נשארת עדכנית. מה שעדיין דורש Monday: דיגסט שבועי במייל, ואוטומציות שכותבות חזרה ללוח." },
            { q: "אנחנו כבר עובדים עם Monday שנים. מה זה מוסיף?", a: "בדיוק בשביל זה. ה-Monday שלכם כבר מכיל את הכל — AnyDay רק הופכת אותו לקריא: תמונת מצב במקום טבלאות, תובנות שעולות לבד, ופעולות שאפשר לעשות מכאן והן מתעדכנות חזרה בבורד." },
            { q: "אפשר להקים בורד חדש מתוך AnyDay?", a: "כן. תארו במילים מה צריך — AnyDay מקימה בורד עם עמודות, קבוצות ואוטומציות, בלי לצאת מהמסך. זו נוחות בתוך המוצר, לא פרויקט הטמעה שאנחנו עושים בשבילכם." },
            { q: "ואם לא מתאים?", a: "בתקופת הפיילוט מצטרפים בחינם, אז אין מה להפסיד. לא מתאים? מנתקים את Monday בלחיצה — בלי חוזה, בלי שיחת שימור, בלי התחייבות." },
            { q: "הנתונים שלנו בטוחים?", a: "הצפנה מלאה, ואיננו מאמנים מודלים על הנתונים שלכם. שאילתות הדשבורד רצות בזמן אמת מול Monday ואינן נשמרות. מה שכן נשמר אצלנו: הגדרות הארגון, וכל בורד שבניתם דרך הבונה — עד שתמחקו אותו." },
          ].map((faq, i) => (
            <div key={i} className={`faq ${openFaq === i ? "faq--open" : ""}`} data-reveal
              onClick={() => setOpenFaq(openFaq === i ? null : i)}>
              <div className="faq__q">
                <span>{faq.q}</span>
                <span className="faq__icon">{openFaq === i ? "−" : "+"}</span>
              </div>
              <div className="faq__a"><p>{faq.a}</p></div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="final">
        <div className="final__bg" />
        <div className="final__content" data-reveal>
          <h2 className="final__title">
            הנתונים שלכם<br/>כבר יודעים הכל.<br/>עכשיו גם תראו.
          </h2>
          <p className="final__accent">מחברים את Monday או מעלים גיליון — והדשבורד נבנה לבד, בדקות, בלי הגדרה אחת.</p>
          <p className="final__sub">ללא כרטיס אשראי · אפס הגדרות · ביטול בלחיצה</p>
          <a href="/app" className="btn btn--lime btn--xl">חברו את ה-Monday שלכם →</a>
          <p className="final__sub" style={{marginTop: 14}}><a href="/sheet" style={{color: "inherit", textDecoration: "underline"}}>או הדביקו קישור לגיליון Google — בלי חשבון</a></p>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="foot">
        <a href="/" className="nav__logo"><span className="nav__mark nav__mark--sm">A</span><span className="nav__name">AnyDay</span></a>
        {/* A buyer's lawyer looks for these in the footer before anywhere else. */}
        <p>
          <a href="/terms">תנאי שימוש</a>
          {" · "}
          <a href="/privacy">מדיניות פרטיות</a>
        </p>
        <p>&copy; {new Date().getFullYear()} AnyDay</p>
      </footer>
    </div>
  );
}
