export const crmNavigation = [
  { label: 'Overview', href: '/', icon: 'grid' },
  { label: 'Leads', href: '/leads', icon: 'users' },
  { label: 'Contacts', href: '/contacts', icon: 'contact' },
  { label: 'Companies', href: '/companies', icon: 'building' },
  { label: 'Deals', href: '/deals', icon: 'briefcase' },
  { label: 'Vendors', href: '/vendors', icon: 'vendors' },
  { label: 'Billing & Invoicing', href: '/billing-invoicing', icon: 'billing' },
  { label: 'Activities', href: '/activities', icon: 'calendar' },
  { label: 'Automation', href: '/automation', icon: 'sparkles' },
  { label: 'Email', href: '/email', icon: 'bell' },
  { label: 'Reports', href: '/reports', icon: 'chart' },
  { label: 'Audit Logs', href: '/audit-logs', icon: 'search' },
  { label: 'Settings', href: '/settings', icon: 'settings' },
  { label: 'Team', href: '/team', icon: 'team' },
  { label: 'Subscription', href: '/subscription', icon: 'subscription' },
] as const;

export function navigationForModules<T extends { label: string; href: string }>(
  navigation: readonly T[],
  enabledModules: string[] | null | undefined,
) {
  return navigation.filter(({ label, href }) =>
    label === 'Overview' || (enabledModules !== null && enabledModules !== undefined && enabledModules.includes(href.slice(1))),
  );
}
