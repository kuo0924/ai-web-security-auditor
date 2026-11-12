import { Platform } from 'react-native';
import { openExpoDb } from '../data/expoDb';
import { Repo } from '../data/repo';
import { nativeLibrary } from '../media/nativeLibrary';
import { SimilarController } from '../similar/controller';
import { nativeImageSource } from '../similar/imageSource';
import { SessionController } from './session';

export type AppControllers = { session: SessionController; similar: SimilarController };

export async function createSession(): Promise<AppControllers> {
  const db = await openExpoDb();
  const repo = new Repo(db, Platform.OS === 'ios' ? 'ios' : 'android');
  const session = new SessionController(repo, nativeLibrary);
  return { session, similar: new SimilarController(repo, nativeLibrary, nativeImageSource, session) };
}
