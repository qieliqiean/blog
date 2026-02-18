(() => {
  const run = () => {
    const progress = document.createElement('div');
    progress.id = 'scroll-progress';
    document.body.appendChild(progress);

    let ticking = false;
    const updateProgress = () => {
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop || document.body.scrollTop;
      const scrollHeight = doc.scrollHeight - doc.clientHeight;
      const ratio = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
      progress.style.width = `${Math.min(100, Math.max(0, ratio))}%`;
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateProgress);
        ticking = true;
      }
    });
    updateProgress();

    const revealEls = document.querySelectorAll('.reveal');
    if (!revealEls.length) return;

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -8% 0px' }
    );

    revealEls.forEach(el => observer.observe(el));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
