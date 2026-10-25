// The references the Learn page cites. Only entries whose details were checked against the
// publisher's or arXiv's own page are here (plan §13, §14); anything that could not be checked
// was left out, and details that could not be checked (a volume or page) are not given.

export interface Reference {
  id: string;
  authors: string;
  year: number;
  title: string;
  /** Where it appeared, with only the details that were checked. */
  venue: string;
  links: { label: string; href: string }[];
}

export const REFERENCES: readonly Reference[] = [
  {
    id: 'wisdom-holman-1991',
    authors: 'J. Wisdom and M. Holman',
    year: 1991,
    title: 'Symplectic maps for the N-body problem',
    venue: 'The Astronomical Journal 102, 1528-1538',
    links: [{ label: 'ADS', href: 'https://ui.adsabs.harvard.edu/abs/1991AJ....102.1528W/abstract' }],
  },
  {
    id: 'rein-spiegel-2015',
    authors: 'H. Rein and D. S. Spiegel',
    year: 2015,
    title: 'IAS15: a fast, adaptive, high-order integrator for gravitational dynamics, accurate to machine precision over a billion orbits',
    venue: 'Monthly Notices of the Royal Astronomical Society 446, 1424-1437',
    links: [{ label: 'arXiv:1409.4779', href: 'https://arxiv.org/abs/1409.4779' }],
  },
  {
    id: 'rein-tamayo-2015',
    authors: 'H. Rein and D. Tamayo',
    year: 2015,
    title: 'WHFast: a fast and unbiased implementation of a symplectic Wisdom-Holman integrator for long-term gravitational simulations',
    venue: 'Monthly Notices of the Royal Astronomical Society',
    links: [{ label: 'arXiv:1506.01084', href: 'https://arxiv.org/abs/1506.01084' }],
  },
  {
    id: 'rein-tamayo-2018',
    authors: 'H. Rein and D. Tamayo',
    year: 2018,
    title: 'JANUS: a bit-wise reversible integrator for N-body dynamics',
    venue: 'Monthly Notices of the Royal Astronomical Society',
    links: [{ label: 'arXiv:1704.07715', href: 'https://arxiv.org/abs/1704.07715' }],
  },
  {
    id: 'pham-rein-spiegel-2024',
    authors: 'D. Pham, H. Rein and D. S. Spiegel',
    year: 2024,
    title: 'A new timestep criterion for N-body simulations',
    venue: 'The Open Journal of Astrophysics 7',
    links: [{ label: 'arXiv:2401.02849', href: 'https://arxiv.org/abs/2401.02849' }],
  },
  {
    id: 'everhart-1985',
    authors: 'E. Everhart',
    year: 1985,
    title: 'An efficient integrator that uses Gauss-Radau spacings',
    venue: 'in Dynamics of Comets: Their Origin and Evolution (IAU Colloquium 83), eds. A. Carusi and G. B. Valsecchi, Reidel, pp. 185-202',
    links: [{ label: 'DOI', href: 'https://doi.org/10.1007/978-94-009-5400-7_17' }],
  },
  {
    id: 'yoshida-1990',
    authors: 'H. Yoshida',
    year: 1990,
    title: 'Construction of higher order symplectic integrators',
    venue: 'Physics Letters A 150, 262',
    links: [],
  },
  {
    id: 'moore-1993',
    authors: 'C. Moore',
    year: 1993,
    title: 'Braids in classical dynamics',
    venue: 'Physical Review Letters 70, 3675',
    links: [{ label: 'APS', href: 'https://link.aps.org/doi/10.1103/PhysRevLett.70.3675' }],
  },
  {
    id: 'chenciner-montgomery-2000',
    authors: 'A. Chenciner and R. Montgomery',
    year: 2000,
    title: 'A remarkable periodic solution of the three-body problem in the case of equal masses',
    venue: 'Annals of Mathematics 152, 881-901',
    links: [{ label: 'arXiv:math/0011268', href: 'https://arxiv.org/abs/math/0011268' }],
  },
  {
    id: 'suvakov-dmitrasinovic-2013',
    authors: 'M. Šuvakov and V. Dmitrašinović',
    year: 2013,
    title: 'Three classes of Newtonian three-body planar periodic orbits',
    venue: 'Physical Review Letters 110, 114301',
    links: [{ label: 'arXiv:1303.0181', href: 'https://arxiv.org/abs/1303.0181' }],
  },
  {
    id: 'li-liao-2013',
    authors: 'X. Li and S. Liao',
    year: 2013,
    title: "A commend on 'Three Classes of Newtonian Three-Body Planar Periodic Orbits' by Šuvakov and Dmitrašinović (PRL, 2013)",
    venue: 'arXiv preprint',
    links: [{ label: 'arXiv:1312.6796', href: 'https://arxiv.org/abs/1312.6796' }],
  },
  {
    id: 'szebehely-peters-1967',
    authors: 'V. Szebehely and C. F. Peters',
    year: 1967,
    title: 'Complete solution of a general problem of three bodies',
    venue: 'The Astronomical Journal 72, 876',
    links: [{ label: 'ADS scan', href: 'https://articles.adsabs.harvard.edu/pdf/1967AJ.....72..876S' }],
  },
  {
    id: 'ito-ohtsuka-2019',
    authors: 'T. Ito and K. Ohtsuka',
    year: 2019,
    title: 'The Lidov-Kozai oscillation and Hugo von Zeipel',
    venue: 'Monographs on Environment, Earth and Planets 7(1), 1-113',
    links: [{ label: 'arXiv:1911.03984', href: 'https://arxiv.org/abs/1911.03984' }],
  },
  {
    id: 'rein-liu-2012',
    authors: 'H. Rein and S.-F. Liu',
    year: 2012,
    title: 'REBOUND: an open-source multi-purpose N-body code for collisional dynamics',
    venue: 'Astronomy & Astrophysics 537, A128',
    links: [{ label: 'arXiv:1110.4876', href: 'https://arxiv.org/abs/1110.4876' }],
  },
];

/** The HTML of the reference list. */
export function renderReferences(references: readonly Reference[] = REFERENCES): string {
  const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const items = references.map((r) => {
    const links = r.links.map((l) => `<a href="${escape(l.href)}" rel="noopener">${escape(l.label)}</a>`).join(', ');
    return `<li id="ref-${r.id}">${escape(r.authors)} (${r.year}). <em>${escape(r.title)}</em>. ${escape(r.venue)}.${links ? ` ${links}` : ''}</li>`;
  });
  return `<ol class="references">${items.join('')}</ol>`;
}
