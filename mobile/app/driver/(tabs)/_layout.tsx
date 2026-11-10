import { RoleTabs } from '@/components/nav';

export default function DriverTabs() {
  return <RoleTabs tabs={[{ name: 'index', title: 'Current trip', icon: 'navigate-outline' }, { name: 'trips', title: 'My trips', icon: 'list-outline' }, { name: 'account', title: 'Profile', icon: 'person-outline' }]} />;
}
