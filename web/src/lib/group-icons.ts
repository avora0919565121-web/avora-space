import {
  Bike, BookOpen, Cake, Camera, Coffee, Fish, Flower2, Gift, Heart, Home, Leaf, Moon, Mountain, Music, Palette,
  PawPrint, Plane, School, Smile, Star, Sun, Tent, TreePine, Trophy, type LucideIcon,
} from "lucide-react";

/** K5 · 84 §4.1: the Avora group-icon set, by the key stored in conversation_appearance.icon_key. */
export const GROUP_ICONS: Readonly<Record<string, LucideIcon>> = {
  home: Home, leaf: Leaf, book: BookOpen, trophy: Trophy, music: Music, cake: Cake, plane: Plane, heart: Heart,
  star: Star, sun: Sun, coffee: Coffee, camera: Camera, flower: Flower2, mountain: Mountain, fish: Fish, bike: Bike,
  palette: Palette, gift: Gift, tent: Tent, smile: Smile, school: School, tree: TreePine, moon: Moon, paw: PawPrint,
};
