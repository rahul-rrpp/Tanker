import { RoleTabs } from '@/components/nav';

export default function TransporterTabs() {
  return <RoleTabs tabs={[{ name: 'index', title: 'Home', icon: 'home-outline' }, { name: 'market', title: 'Bookings', icon: 'search-outline' }, { name: 'offers', title: 'Offers', icon: 'pricetags-outline' }, { name: 'trips', title: 'Trips', icon: 'navigate-outline' }, { name: 'account', title: 'Account', icon: 'person-outline' }]} />;
}
