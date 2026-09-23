package org.smaran.repo;

import java.util.List;
import org.smaran.domain.FamilyMember;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FamilyMemberRepository extends JpaRepository<FamilyMember, String> {

    List<FamilyMember> findByPatientIdOrderByCurrentPhaseDesc(String patientId);
}
