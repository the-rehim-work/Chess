namespace backend.Services
{
    public sealed class EloService
    {
        public (int newEloA, int newEloB) Calculate(int eloA, int eloB, string outcome, int gamesPlayedA, int gamesPlayedB)
        {
            var scoreA = outcome switch
            {
                "w" => 1.0,
                "b" => 0.0,
                "draw" => 0.5,
                _ => throw new ArgumentException("Outcome must be 'w', 'b', or 'draw'.", nameof(outcome))
            };
            var scoreB = 1.0 - scoreA;

            var expectedA = 1.0 / (1.0 + Math.Pow(10.0, (eloB - eloA) / 400.0));
            var expectedB = 1.0 / (1.0 + Math.Pow(10.0, (eloA - eloB) / 400.0));

            var kA = GetKFactor(eloA, gamesPlayedA);
            var kB = GetKFactor(eloB, gamesPlayedB);

            var newA = Math.Max(100, (int)Math.Round(eloA + kA * (scoreA - expectedA), MidpointRounding.AwayFromZero));
            var newB = Math.Max(100, (int)Math.Round(eloB + kB * (scoreB - expectedB), MidpointRounding.AwayFromZero));
            return (newA, newB);
        }

        public static string GetLeague(int elo)
        {
            if (elo >= 2700) return "Grandmaster";
            if (elo >= 2400) return "Master";

            if (elo >= 2100) return DiamondTier(elo);
            if (elo >= 1800) return PlatinumTier(elo);
            if (elo >= 1400) return FourDivisionTier("Gold", elo, 1400);
            if (elo >= 1000) return FourDivisionTier("Silver", elo, 1000);
            if (elo >= 600) return FourDivisionTier("Bronze", elo, 600);
            if (elo >= 100) return IronTier(elo);

            return "Iron IV";
        }

        private static int GetKFactor(int elo, int gamesPlayed)
        {
            if (gamesPlayed < 30) return 40;
            if (elo >= 2400) return 10;
            return 20;
        }

        private static string FourDivisionTier(string name, int elo, int start)
        {
            var bucket = Math.Clamp((elo - start) / 100, 0, 3);
            return $"{name} {bucket switch { 0 => "IV", 1 => "III", 2 => "II", _ => "I" }}";
        }

        private static string IronTier(int elo)
        {
            var bucket = Math.Clamp((elo - 100) / 125, 0, 3);
            return $"Iron {bucket switch { 0 => "IV", 1 => "III", 2 => "II", _ => "I" }}";
        }

        private static string PlatinumTier(int elo)
        {
            var bucket = Math.Clamp((elo - 1800) / 100, 0, 2);
            return $"Platinum {bucket switch { 0 => "III", 1 => "II", _ => "I" }}";
        }

        private static string DiamondTier(int elo)
        {
            var bucket = Math.Clamp((elo - 2100) / 100, 0, 2);
            return $"Diamond {bucket switch { 0 => "III", 1 => "II", _ => "I" }}";
        }
    }
}
