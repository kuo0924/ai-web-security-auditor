import { Platform } from 'react-native';
import { openExpoDb } from '../data/expoDb';
import { Repo } from '../data/repo';
import { nativeLibrary } from '../media/nativeLibrary';
import { SessionController } from './session';

export async function createSession(): Promise<SessionController> {
  const db = await openExpoDb();
  return new SessionController(new Repo(db, Platform.OS === 'ios' ? 'ios' : 'android'), nativeLibrary);
}
