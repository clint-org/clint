/**
 * Platform-owned legal content. These documents are authored as Clint\'s
 * (the platform operator / sub-processor) own Privacy Policy and Terms of
 * Service. They are NOT brand-swapped per host: a tenant\'s display name
 * never appears in the legal body. Only surrounding chrome (footer brand
 * name, logo) is host-aware. Per-agency uploaded legal docs are a future
 * feature; see docs/superpowers/specs/2026-06-06-public-site-pages-design.md.
 *
 * NOT LEGAL ADVICE. This is a generic starting template that must be
 * reviewed by qualified counsel before it is relied upon.
 */
export const PLATFORM_OPERATOR = 'Clint';
export const PLATFORM_LEGAL_EMAIL = 'privacy@clintapp.com';
/** General contact / support mailbox (distinct from the legal/privacy one). */
export const PLATFORM_SUPPORT_EMAIL = 'support@clintapp.com';
export const LAST_UPDATED = 'June 7, 2026';

export interface LegalSection {
  heading: string;
  body: string[];
}

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: 'Who we are',
    body: [
      'Clint is a competitive intelligence platform for pharmaceutical teams, operated by Clint ("Clint", "we", "us"). This policy explains what personal data we process when you use the platform and the websites that serve it.',
      'Where Clint is provided to you through a consulting partner, that partner determines how the workspace is used. In data protection terms Clint generally acts as a processor or sub-processor and the partner or your organization acts as the controller. This policy describes Clint\'s own processing as the platform operator.',
    ],
  },
  {
    heading: 'Data we process',
    body: [
      'Account data: your name, work email address, and authentication identifiers from the sign-in provider you use (for example Google).',
      'Usage data: technical logs such as IP address, browser type, and pages accessed, used to operate, secure, and improve the service.',
      'Content data: the competitive intelligence records, notes, and materials you and your team enter into a workspace. This content belongs to your organization; we process it to provide the service.',
    ],
  },
  {
    heading: 'How we use data',
    body: [
      'We use personal data to authenticate you, provide and maintain the platform, keep it secure, respond to support requests, and meet legal obligations. We do not sell personal data.',
    ],
  },
  {
    heading: 'Cookies',
    body: [
      'We use strictly necessary cookies to keep you signed in, including a session cookie scoped to our domain so that you stay authenticated across workspace subdomains. We do not use advertising or third-party tracking cookies.',
    ],
  },
  {
    heading: 'Sharing and sub-processors',
    body: [
      'We share data with infrastructure providers that host and deliver the platform (including our cloud database and content delivery providers) strictly to operate the service, under contractual confidentiality and data-protection terms.',
    ],
  },
  {
    heading: 'Data retention and security',
    body: [
      'We retain personal data for as long as your account or workspace is active, and as needed to comply with legal obligations. We apply technical and organizational measures, including encryption in transit and access controls, to protect data.',
    ],
  },
  {
    heading: 'Your rights',
    body: [
      'Depending on your location you may have rights to access, correct, export, or delete your personal data, and to object to or restrict certain processing. To exercise these rights, contact us at privacy@clintapp.com. If your workspace is administered by a consulting partner or your employer, we may direct your request to that controller.',
    ],
  },
  {
    heading: 'Contact',
    body: [
      'Questions about this policy or your data can be sent to privacy@clintapp.com.',
    ],
  },
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: 'Agreement',
    body: [
      'These Terms of Service govern your access to and use of the Clint platform operated by Clint. By accessing or using the platform you agree to these terms. If you use Clint on behalf of an organization, you accept these terms for that organization.',
      'Where Clint is delivered to you through a consulting partner, your relationship with that partner is governed by your separate agreement with them; these terms govern your use of the underlying Clint platform.',
    ],
  },
  {
    heading: 'Accounts',
    body: [
      'You are responsible for safeguarding your account and for all activity that occurs under it. You must provide accurate information and notify us promptly of any unauthorized use.',
    ],
  },
  {
    heading: 'Acceptable use',
    body: [
      'You agree not to misuse the platform, including by attempting to access data you are not authorized to access, disrupting the service, reverse engineering it, or using it to violate any law or third-party right.',
    ],
  },
  {
    heading: 'Customer content',
    body: [
      'You retain ownership of the content you submit to your workspace. You grant Clint the rights necessary to host and process that content to provide the service. You are responsible for ensuring you have the rights to submit it.',
    ],
  },
  {
    heading: 'Intellectual property',
    body: [
      'The platform, including its software, design, and trademarks, is owned by Clint and its licensors. These terms do not grant you any rights to that intellectual property except the limited right to use the platform as permitted here.',
    ],
  },
  {
    heading: 'Disclaimers and liability',
    body: [
      'The platform is provided "as is" without warranties of any kind to the extent permitted by law. Clint is not liable for indirect, incidental, or consequential damages arising from your use of the platform. Nothing in these terms limits liability that cannot be limited by law.',
    ],
  },
  {
    heading: 'Changes and termination',
    body: [
      'We may update these terms from time to time; material changes will be reflected by the "last updated" date. We may suspend or terminate access for breach of these terms. You may stop using the platform at any time.',
    ],
  },
  {
    heading: 'Contact',
    body: [
      'Questions about these terms can be sent to privacy@clintapp.com.',
    ],
  },
];
