import { RoleTabs } from '@/components/nav';

export default function CompanyTabs() {
  return <RoleTabs tabs={[{ name: 'index', title: 'Home', icon: 'home-outline' }, { name: 'bookings', title: 'Bookings', icon: 'document-text-outline' }, { name: 'offers', title: 'Offers', icon: 'pricetags-outline' }, { name: 'trips', title: 'Trips', icon: 'navigate-outline' }, { name: 'account', title: 'Account', icon: 'person-outline' }]} />;
}
