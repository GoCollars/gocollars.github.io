/* Small vector illustrations explain labels; they do not reconstruct recorded motion. */
window.GoCollarsBehaviors = (() => {
  const actions = {
    'Galloping': 'galloping',
    'Lying chest': 'lying',
    'Sitting': 'sitting',
    'Sniffing': 'sniffing',
    'Standing': 'standing',
    'Trotting': 'trotting',
    'Walking': 'walking'
  };
  let cards = [];

  const head = `<g class="pet-head">
    <path class="pet-fur" d="M109 40L111 29Q116 23 126 27L135 31L145 34Q150 35 146 40L136 45Q122 49 113 44Z"/>
    <path class="pet-ear" d="M115 27Q104 23 105 35Q106 46 113 42L120 30Z"/>
    <circle class="pet-eye" cx="132" cy="33" r="1.7"/>
    <path class="pet-nose" d="M143 33Q150 32 148 37Q145 39 143 36Z"/>
    <path class="pet-mouth" d="M135 41Q140 43 145 40"/>
    <path class="pet-collar" d="M109 40L119 47"/>
    <circle class="pet-tag" cx="114" cy="48" r="2.7"/>
  </g>`;

  function standing(sniffing) {
    return `<g class="pet-mover">
      <g class="pet-leg leg-rear-far"><path d="M66 61L67 76L64 89H72"/></g>
      <g class="pet-leg leg-front-far"><path d="M101 61L100 76L98 89H107"/></g>
      <path class="pet-tail" d="M54 51Q37 49 30 34"/>
      <path class="pet-fur" d="${sniffing ? 'M52 50C62 42 86 42 101 46Q113 47 116 60Q108 66 99 65L64 65Q51 64 52 50Z' : 'M52 50C61 42 86 42 100 46L110 33L121 39L116 56Q111 64 100 65L64 65Q51 64 52 50Z'}"/>
      <g class="pet-leg leg-rear-near"><path d="M61 62L61 76L58 90H67"/></g>
      <g class="pet-leg leg-front-near"><path d="M108 60L110 76L108 90H117"/></g>
      ${sniffing ? '<path class="pet-neck" d="M105 51Q115 58 113 68"/>' : ''}
      ${head}
    </g>`;
  }

  function sitting() {
    return `<g class="pet-mover sitting-pose">
      <path class="pet-tail" d="M70 83C61 89 55 93 47 91Q41 90 42 86"/>
      <path class="sitting-leg-far" d="M107 59L105 86Q103 90 107 92H117Q121 92 118 89L112 86L114 61Z"/>
      <path class="pet-fur" d="M91 43C94 37 105 34 113 39L120 45C118 54 112 60 109 67L106 88H77C65 88 61 83 65 73C68 64 79 61 84 53Z"/>
      <path class="sitting-chest" d="M108 47Q117 48 113 56L106 69L102 76L99 68Q100 56 108 47Z"/>
      <path class="pet-haunch" d="M77 67C67 68 61 77 65 85Q68 90 79 90H94Q98 90 98 93H75C64 93 59 87 61 79Q63 69 73 67Z"/>
      <path class="sitting-fold" d="M77 75Q68 77 71 83Q73 87 82 87"/>
      <path class="sitting-leg-near" d="M102 61Q108 59 112 63L110 86Q110 89 117 89Q122 89 122 93H108Q103 93 103 88L101 69Z"/>
      ${head}
    </g>`;
  }

  function lying() {
    return `<g class="pet-mover">
      <path class="pet-tail" d="M57 79Q39 79 34 72"/>
      <path class="pet-fur" d="M51 79Q56 66 76 67L96 70L112 63L119 76L110 89H67Q51 89 51 79Z"/>
      <path class="pet-paw" d="M66 83L83 86L88 91H60"/>
      <path class="pet-paw" d="M106 82L132 87Q137 88 136 92H107"/>
      <g class="lying-head">${head}</g>
    </g>`;
  }

  function picture(action, label) {
    const body = action === 'sitting' ? sitting() : action === 'lying' ? lying() : standing(action === 'sniffing');
    return `<svg class="action-dog" viewBox="0 0 180 110" role="img" aria-label="${label}动作示意">
      <ellipse class="pet-shadow" cx="89" cy="94" rx="58" ry="3"/>
      <g class="pet-ground"><path d="M17 96H36M48 96H57M137 96H156"/></g>
      <g class="pet-speed"><path d="M17 53H31M11 64H26M22 75H34"/></g>
      ${body}
      <g class="pet-scent"><path d="M139 87Q135 82 140 78M148 89Q145 84 150 80"/></g>
    </svg>`;
  }

  function mount(container, classes, labels, onSelect) {
    cards = classes.map(label => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-card';
      button.dataset.action = actions[label];
      button.dataset.label = label;
      button.setAttribute('aria-label', `${labels[label]}：查看对应 IMU 样本`);
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = picture(actions[label], labels[label]) + `<span>${labels[label]}</span>`;
      button.addEventListener('click', () => onSelect(label));
      return button;
    });
    container.replaceChildren(...cards);
  }

  function select(label) {
    cards.forEach(card => card.setAttribute('aria-pressed', String(card.dataset.label === label)));
  }

  return {mount, select};
})();
